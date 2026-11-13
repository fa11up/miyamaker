"use strict";

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { LocalGenerationQueue } = require("../localGenerationQueue.js");

const execFileAsync = promisify(execFile);

const DEFAULT_BACKEND_PATH = "/Applications/DiffusionBee.app/Contents/Resources/core/diffusionbee_backend";
const DEFAULT_WORKDIR = path.join(os.homedir(), ".diffusionbee");
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp)$/i;

const queue = new LocalGenerationQueue();
const bridges = new Map();
let shutdownHooksInstalled = false;

function cleanString(value) {
  return String(value || "").trim();
}

function cleanNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getDiffusionBeeConfig(options = {}) {
  return {
    provider: "diffusionbee",
    backendPath: path.resolve(cleanString(options.backendPath || process.env.DIFFUSIONBEE_BACKEND_PATH) || DEFAULT_BACKEND_PATH),
    workdir: path.resolve(cleanString(options.workdir || process.env.DIFFUSIONBEE_WORKDIR) || DEFAULT_WORKDIR),
    timeoutMs: Math.round(cleanNumber(options.timeoutMs || options.timeout_ms || process.env.DIFFUSIONBEE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 10000, 3600000)),
    pollIntervalMs: Math.round(cleanNumber(options.pollIntervalMs || options.poll_interval_ms || process.env.DIFFUSIONBEE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 250, 30000)),
    model: cleanString(options.model || process.env.DIFFUSIONBEE_MODEL),
  };
}

async function getDiffusionBeeStatus(options = {}) {
  const config = getDiffusionBeeConfig(options);
  const status = {
    configured: false,
    ready: false,
    backendFound: false,
    executable: false,
    processReady: false,
    backendPath: config.backendPath,
    workdir: config.workdir,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    models: [],
    selectedModel: "",
    error: "",
  };

  try {
    const stat = await fsp.stat(config.backendPath);
    status.backendFound = stat.isFile();
    await fsp.access(config.backendPath, fs.constants.X_OK);
    status.executable = true;
  } catch (e) {
    status.error = `DiffusionBee backend not found or not executable at ${config.backendPath}`;
    return status;
  }

  try {
    await fsp.mkdir(config.workdir, { recursive: true });
    status.models = await listDiffusionBeeModels(config.workdir);
    const selected = resolveModel(config.model, status.models);
    status.selectedModel = selected ? selected.id : "";
    if (!selected) {
      status.error = "No DiffusionBee Stable Diffusion model was found. Open DiffusionBee once and download/import a model.";
      return status;
    }
    const bridge = bridges.get(bridgeKey(config));
    status.processReady = Boolean(bridge && bridge.isAlive() && bridge.ready);
    status.configured = true;
    status.ready = true;
    return status;
  } catch (e) {
    status.error = e.message;
    return status;
  }
}

async function listDiffusionBeeModels(workdir = DEFAULT_WORKDIR) {
  const models = [];
  const seen = new Set();
  const files = [
    { file: "downloaded_assets.json", source: "downloaded" },
    { file: "locally_loaded_assets.json", source: "local" },
  ];

  for (const entry of files) {
    const full = path.join(workdir, entry.file);
    const data = await readJson(full, {});
    for (const [id, asset] of Object.entries(data || {})) {
      const meta = asset && asset.model_meta_data ? asset.model_meta_data : {};
      const assetPath = cleanString(asset && asset.asset_path);
      if (meta.type !== "sd_model" || !assetPath || seen.has(id)) continue;
      if (!fs.existsSync(assetPath)) continue;
      seen.add(id);
      models.push({
        id,
        title: cleanString(asset.title || asset.asset_name || asset.name) || id,
        assetPath,
        source: entry.source,
        sdType: meta.sd_type || "",
        floatType: meta.float_type || "",
      });
    }
  }

  return models.sort((a, b) => {
    if (a.id === "Default_SDB_0.1") return -1;
    if (b.id === "Default_SDB_0.1") return 1;
    return a.title.localeCompare(b.title);
  });
}

async function generateWithDiffusionBee({ inputImagePath, prompt, mode, outputPath, metadata, options = {} }) {
  installShutdownHooks();
  return queue.enqueue((token) => runDiffusionBeeGeneration({ inputImagePath, prompt, mode, outputPath, metadata, options, token }));
}

function throwIfCancelled(token) {
  if (token && token.isCancelled()) throw new Error(token.reason ? token.reason() : "AI Chef generation cancelled");
}

async function runDiffusionBeeGeneration({ inputImagePath, prompt, mode, outputPath, metadata, options = {}, token }) {
  throwIfCancelled(token);
  const config = getDiffusionBeeConfig(options);
  const status = await getDiffusionBeeStatus(options);
  throwIfCancelled(token);
  if (!status.backendFound) throw new Error(status.error || `DiffusionBee backend missing at ${config.backendPath}`);
  if (!status.executable) throw new Error(status.error || `DiffusionBee backend is not executable at ${config.backendPath}`);
  if (!status.ready) throw new Error(status.error || "DiffusionBee provider is not ready");

  const models = status.models;
  const model = resolveModel(config.model, models);
  if (!model) throw new Error("No usable DiffusionBee model selected");

  await fsp.access(inputImagePath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  if (path.resolve(inputImagePath) === path.resolve(outputPath)) {
    throw new Error("Output path cannot overwrite the source image");
  }

  const preparedInput = await prepareInputImage(inputImagePath, config.workdir);
  const imageSize = await getImageDimensions(inputImagePath);
  throwIfCancelled(token);
  const parameters = buildImg2ImgPayload({
    inputImagePath,
    inputImageWithMask: preparedInput,
    prompt,
    imageSize,
    model,
    options,
  });

  try {
    const bridge = getBridge(config);
    const result = await bridge.runJob(parameters, config.timeoutMs, {
      onProgress: options.onProgress,
      onStatus: options.onStatus,
    });

    throwIfCancelled(token);
    const generatedPath = findGeneratedImagePath(result);
    if (!generatedPath) throw new Error("DiffusionBee did not return a generated image path");
    await validateImageFile(generatedPath);
    throwIfCancelled(token);
    await copyImageToOutput(generatedPath, outputPath, imageSize);
    await validateImageFile(outputPath);

    return {
      provider: "diffusionbee",
      mode,
      outputPath,
      metadata: {
        ...(metadata || {}),
        aiChef: {
          provider: "diffusionbee",
          prompt,
          backendPath: config.backendPath,
          workdir: config.workdir,
          model: model.id,
          generatedPath,
          parameters: {
            strength: parameters.input_image_strength,
            guidance_scale: parameters.guidance_scale,
            num_inference_steps: parameters.num_steps,
            negative_prompt: parameters.negative_prompt || "",
            scheduler: parameters.scheduler,
            seed: parameters.seed,
          },
        },
      },
    };
  } finally {
    await fsp.rm(preparedInput, { force: true }).catch(() => {});
  }
}

class DiffusionBeeBridge {
  constructor(config) {
    this.config = config;
    this.child = null;
    this.buffer = "";
    this.ready = false;
    this.starting = null;
    this.activeJob = null;
    this.readyWaiters = [];
    this.stderrTail = "";
  }

  isAlive() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async ensureStarted(timeoutMs) {
    if (this.isAlive()) {
      if (this.ready) return;
      await this.waitForReady(timeoutMs);
      return;
    }
    if (!this.starting) this.starting = this.start(timeoutMs);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  start(timeoutMs) {
    return new Promise((resolve, reject) => {
      this.ready = false;
      this.stderrTail = "";
      this.child = spawn(this.config.backendPath, [], {
        cwd: path.dirname(this.config.backendPath),
        env: { ...process.env, HOME: os.homedir() },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child.stdin.setDefaultEncoding("utf8");

      const timer = setTimeout(() => {
        reject(new Error(`DiffusionBee backend did not become ready within ${timeoutMs}ms`));
      }, timeoutMs);

      const finishReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const failStart = (error) => {
        clearTimeout(timer);
        reject(error);
      };

      this.readyWaiters.push({ resolve: finishReady, reject: failStart });

      this.child.stdout.on("data", chunk => this.onStdout(chunk));
      this.child.stderr.on("data", chunk => this.onStderr(chunk));
      this.child.on("error", err => {
        this.rejectReadyWaiters(err);
        this.rejectActiveJob(err);
      });
      this.child.on("close", (code, signal) => {
        const suffix = this.stderrTail ? `: ${this.stderrTail}` : "";
        const exitText = code === null ? `signal ${signal || "unknown"}` : `code ${code}`;
        const err = new Error(`DiffusionBee backend exited with ${exitText}${suffix}`);
        this.ready = false;
        this.rejectReadyWaiters(err);
        this.rejectActiveJob(err);
      });
    });
  }

  waitForReady(timeoutMs) {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`DiffusionBee backend did not become ready within ${timeoutMs}ms`)), timeoutMs);
      this.readyWaiters.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
    });
  }

  runJob(payload, timeoutMs, callbacks = {}) {
    return this.ensureStarted(timeoutMs).then(() => new Promise((resolve, reject) => {
      if (!this.isAlive()) {
        reject(new Error("DiffusionBee backend is not running"));
        return;
      }
      if (this.activeJob) {
        reject(new Error("DiffusionBee backend is already running a job"));
        return;
      }

      const timer = setTimeout(() => {
        this.rejectActiveJob(new Error(`DiffusionBee local generation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.ready = false;
      this.activeJob = {
        resolve,
        reject,
        timer,
        onProgress: callbacks.onProgress,
        onStatus: callbacks.onStatus,
      };

      const line = `b2py t2im ${JSON.stringify(payload)}\n`;
      this.child.stdin.write(line, err => {
        if (err) this.rejectActiveJob(err);
      });
    }));
  }

  onStdout(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) this.handleLine(line.trim());
  }

  onStderr(chunk) {
    const text = chunk.toString("utf8").trim();
    if (!text) return;
    this.stderrTail = (this.stderrTail + "\n" + text).trim().slice(-1200);
    if (this.activeJob && /error|exception|traceback|failed/i.test(text)) {
      this.emitJobStatus(text);
    }
  }

  handleLine(line) {
    if (!line) return;
    const idx = line.indexOf("sdbk ");
    if (idx < 0) return;
    const message = line.slice(idx + 5).trim();
    const code = message.slice(0, 4);
    const payload = message.length > 5 ? message.slice(5).trim() : "";

    if (code === "inrd") {
      this.ready = true;
      this.resolveReadyWaiters();
      return;
    }
    if (code === "inwk") {
      this.ready = false;
      this.emitJobStatus("DiffusionBee is working");
      return;
    }
    if (code === "dnpr") {
      const progress = Number(payload);
      if (this.activeJob && typeof this.activeJob.onProgress === "function" && Number.isFinite(progress)) {
        this.activeJob.onProgress(progress);
      }
      return;
    }
    if (code === "errr") {
      this.rejectActiveJob(new Error(payload || "DiffusionBee backend reported an error"));
      return;
    }
    if (code === "nwim") {
      let result;
      try {
        result = JSON.parse(payload);
      } catch (e) {
        this.rejectActiveJob(new Error(`Invalid DiffusionBee result payload: ${e.message}`));
        return;
      }
      this.resolveActiveJob(result);
      return;
    }
    if (code === "mdld" || code === "mldn" || code === "mdvr" || code === "mlpr" || code === "mlms" || code === "gnms" || code === "mltl") {
      this.emitJobStatus(payload || code);
    }
  }

  emitJobStatus(message) {
    if (this.activeJob && typeof this.activeJob.onStatus === "function") {
      this.activeJob.onStatus(message);
    }
  }

  resolveReadyWaiters() {
    const waiters = this.readyWaiters.splice(0);
    waiters.forEach(w => w.resolve());
  }

  rejectReadyWaiters(error) {
    const waiters = this.readyWaiters.splice(0);
    waiters.forEach(w => w.reject(error));
  }

  resolveActiveJob(result) {
    if (!this.activeJob) return;
    const job = this.activeJob;
    this.activeJob = null;
    clearTimeout(job.timer);
    job.resolve(result);
  }

  rejectActiveJob(error) {
    if (!this.activeJob) return;
    const job = this.activeJob;
    this.activeJob = null;
    clearTimeout(job.timer);
    job.reject(error);
  }

  cancelActiveJob(reason = "AI Chef generation cancelled") {
    const hadActiveJob = Boolean(this.activeJob);
    if (hadActiveJob) this.rejectActiveJob(new Error(reason));
    if (this.isAlive()) {
      this.ready = false;
      this.child.kill("SIGTERM");
      const child = this.child;
      setTimeout(() => {
        if (child && child.exitCode === null) child.kill("SIGKILL");
      }, 2000).unref?.();
    }
    return hadActiveJob;
  }

  shutdown() {
    if (this.isAlive()) this.child.kill();
  }
}

function getBridge(config) {
  const key = bridgeKey(config);
  let bridge = bridges.get(key);
  if (!bridge || !bridge.isAlive()) {
    bridge = new DiffusionBeeBridge(config);
    bridges.set(key, bridge);
  }
  return bridge;
}

function bridgeKey(config) {
  return `${config.backendPath}::${config.workdir}`;
}

function shutdownDiffusionBeeProviders() {
  for (const bridge of bridges.values()) bridge.shutdown();
}

function cancelDiffusionBeeGeneration(reason = "AI Chef generation cancelled") {
  queue.cancelAll(reason);
  let activeJobsCancelled = 0;
  let processesSignalled = 0;
  for (const bridge of bridges.values()) {
    const wasAlive = bridge.isAlive();
    const hadActive = bridge.cancelActiveJob(reason);
    if (hadActive) activeJobsCancelled++;
    if (wasAlive) processesSignalled++;
  }
  return { activeJobsCancelled, processesSignalled };
}

function resetDiffusionBeeCancellation() {
  queue.resetCancellation();
}

function installShutdownHooks() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once("exit", shutdownDiffusionBeeProviders);
  process.once("SIGINT", () => {
    shutdownDiffusionBeeProviders();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    shutdownDiffusionBeeProviders();
    process.exit(143);
  });
}

function buildImg2ImgPayload({ inputImagePath, inputImageWithMask, prompt, imageSize, model, options = {} }) {
  const strength = normalizeStrength(options.strength ?? options.input_image_strength ?? process.env.DIFFUSIONBEE_STRENGTH);
  const steps = Math.round(cleanNumber(options.num_inference_steps ?? options.steps ?? process.env.DIFFUSIONBEE_STEPS, 25, 1, 150));
  const guidance = cleanNumber(options.guidance_scale ?? options.guidance ?? process.env.DIFFUSIONBEE_GUIDANCE_SCALE, 7.5, 0, 30);
  const seed = normalizeSeed(options.seed ?? process.env.DIFFUSIONBEE_SEED);
  const scheduler = cleanString(options.scheduler || process.env.DIFFUSIONBEE_SCHEDULER) || "karras";
  const negativePrompt = cleanString(options.negative_prompt || options.negativePrompt || process.env.DIFFUSIONBEE_NEGATIVE_PROMPT);
  const jobId = String(Math.random());

  const rawFormOptions = {
    prompt,
    is_adv_mode: true,
    selected_sd_model: model.id,
    input_image_strength: strength,
    num_imgs: 1,
    num_steps: steps,
    force_use_given_size: false,
    selected_sd_style: "none",
    input_img: inputImagePath,
    input_img__AUX__height: imageSize.height,
    input_img__AUX__width: imageSize.width,
    img_width: imageSize.width,
    img_height: imageSize.height,
    scheduler,
    guidance_scale: guidance,
    selected_sd_lora_0: "None",
    selected_sd_lora_1: "None",
    selected_sd_lora_2: "None",
    lora_0_weight: 1,
    lora_1_weight: 1,
    lora_2_weight: 1,
    do_v_prediction: false,
    is_clip_skip_2: false,
    seed,
  };
  if (negativePrompt) rawFormOptions.negative_prompt = negativePrompt;

  return {
    ...rawFormOptions,
    applet_name: "img2img",
    model_tdict_path: model.assetPath,
    input_image_with_mask: inputImageWithMask,
    job_id: jobId,
    image_no: 0,
    job_state: "todo",
    raw_form_options: rawFormOptions,
  };
}

function normalizeStrength(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 65;
  const asPercent = n <= 1 ? n * 100 : n;
  return cleanNumber(asPercent, 65, 2, 100);
}

function normalizeSeed(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(Math.random() * 1000000);
}

function resolveModel(requested, models) {
  if (!Array.isArray(models) || !models.length) return null;
  const wanted = cleanString(requested);
  if (wanted) {
    const lower = wanted.toLowerCase();
    const exact = models.find(m => m.id === wanted || m.assetPath === wanted);
    if (exact) return exact;
    const fuzzy = models.find(m => m.id.toLowerCase() === lower || m.title.toLowerCase() === lower);
    if (fuzzy) return fuzzy;
  }
  return models.find(m => m.id === "Default_SDB_0.1") || models[0];
}

async function prepareInputImage(inputImagePath, workdir) {
  const ext = IMAGE_EXT_RE.test(path.extname(inputImagePath)) ? path.extname(inputImagePath) : ".png";
  const fileName = `ai-chef-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const preferredDir = path.join(workdir, "inp_images");
  try {
    await fsp.mkdir(preferredDir, { recursive: true });
    const target = path.join(preferredDir, fileName);
    await fsp.copyFile(inputImagePath, target);
    return target;
  } catch (e) {
    if (!/EACCES|EPERM|EROFS/i.test(e.code || e.message)) throw e;
  }

  const fallbackDir = path.join(os.tmpdir(), "ai-chef-diffusionbee", "inp_images");
  await fsp.mkdir(fallbackDir, { recursive: true });
  const fallbackTarget = path.join(fallbackDir, fileName);
  await fsp.copyFile(inputImagePath, fallbackTarget);
  return fallbackTarget;
}

async function getImageDimensions(imagePath) {
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], { maxBuffer: 200000 });
    const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]);
    const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  } catch {}
  return { width: 512, height: 512 };
}

async function copyImageToOutput(sourcePath, outputPath, imageSize) {
  const outFull = path.resolve(outputPath);
  const srcFull = path.resolve(sourcePath);
  if (outFull === srcFull) throw new Error("DiffusionBee output path matches final output path unexpectedly");
  const ext = path.extname(outFull).toLowerCase();
  const resizeArgs = imageSize?.width && imageSize?.height
    ? ["-z", String(imageSize.height), String(imageSize.width)]
    : [];
  if (ext === ".jpg" || ext === ".jpeg") {
    await execFileAsync("sips", ["-s", "format", "jpeg", ...resizeArgs, sourcePath, "--out", outputPath]);
    return;
  }
  if (resizeArgs.length) {
    await execFileAsync("sips", [...resizeArgs, sourcePath, "--out", outputPath]);
    return;
  }
  await fsp.copyFile(sourcePath, outputPath);
}

async function validateImageFile(imagePath) {
  const stat = await fsp.stat(imagePath);
  if (!stat.isFile() || stat.size < 12) throw new Error(`Generated image is empty or invalid: ${imagePath}`);
  const handle = await fsp.open(imagePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    await handle.read(buffer, 0, 16, 0);
    const isPng = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";
    if (!isPng && !isJpeg && !isWebp) {
      throw new Error(`Generated file is not a PNG, JPEG, or WebP image: ${imagePath}`);
    }
  } finally {
    await handle.close();
  }
}

function findGeneratedImagePath(result) {
  if (!result) return "";
  const preferredKeys = ["generated_img_path", "generated_img", "image_url", "out_path", "output_path", "aux_output_image_path"];
  for (const key of preferredKeys) {
    if (typeof result[key] === "string" && IMAGE_EXT_RE.test(result[key])) {
      return stripFileUrl(result[key]);
    }
  }
  return findImagePathDeep(result);
}

function findImagePathDeep(value) {
  if (typeof value === "string" && IMAGE_EXT_RE.test(value)) return stripFileUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImagePathDeep(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findImagePathDeep(item);
      if (found) return found;
    }
  }
  return "";
}

function stripFileUrl(value) {
  return String(value || "").replace(/^file:\/\//, "");
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

module.exports = {
  DEFAULT_BACKEND_PATH,
  getDiffusionBeeConfig,
  getDiffusionBeeStatus,
  listDiffusionBeeModels,
  generateWithDiffusionBee,
  cancelDiffusionBeeGeneration,
  resetDiffusionBeeCancellation,
  shutdownDiffusionBeeProviders,
};
