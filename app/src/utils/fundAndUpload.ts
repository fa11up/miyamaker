import type { WebIrys } from '@irys/sdk'
import type { Chain } from 'viem'

import getIrys, { paymentTxState } from './getIrys'
import { pathInFolder } from './myUploads'
import type { UploadStage } from './uploadError'
import { uploadErrorWords } from './uploadError'
import type { FundingIrys, PaymentStore } from './irysPayment'
import { ensureFunded as ensureFundedWith } from './irysPayment'

type Tag = {
  name: string
  value: string
}

const GATEWAY_BASE = (import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/').endsWith('/')
  ? import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'
  : `${import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'}/`

export type UploadStatus = (words: string) => void

export { FREE_BYTES, PRICE_MARGIN } from './irysPayment'

/** Plain words for what went wrong; the raw error stays in the console. */
function uploadError(e: unknown, stage: UploadStage): Error {
  console.error('Upload failed', e)
  return new Error(uploadErrorWords(e, stage))
}

const paymentKey = (irys: WebIrys) => `miya.irys-payment:${irys.token}:${irys.address}`

/** The same storage and key the payment has always been remembered under, so a payment made before this still counts. */
function paymentStore(irys: WebIrys): PaymentStore {
  return {
    read() {
      try {
        return JSON.parse(window.localStorage.getItem(paymentKey(irys)) ?? 'null') ?? undefined
      } catch {
        return undefined
      }
    },
    write(payment) {
      try {
        if (payment) window.localStorage.setItem(paymentKey(irys), JSON.stringify(payment))
        else window.localStorage.removeItem(paymentKey(irys))
      } catch {
        // Only loses the memory of a payment on its way.
      }
    },
  }
}

function ensureFunded(irys: WebIrys, size: number | readonly number[], setStage: (stage: UploadStage) => void, status?: UploadStatus) {
  return ensureFundedWith(irys as unknown as FundingIrys, size, {
    store: paymentStore(irys),
    txState: (txId) => paymentTxState(irys, txId),
    setStage,
    status,
  })
}

/** Room for what a bundle adds to its files: each item's header and the folder's manifest. */
const BUNDLE_BYTES_PER_FILE = 2048
const MAX_NAME = 200

/** What a folder's bundle will weigh, which is what it is priced on. */
export const folderBytes = (files: File[]) => files.reduce((sum, file) => sum + file.size + BUNDLE_BYTES_PER_FILE, 0)

/**
 * Stores a folder, then signs a small record of it. The files go up as one bundle signed by a throwaway key, so only
 * the record ties the folder to this wallet, and it is written last: a failed upload never lists a broken folder.
 * `listed` is false when the files are stored but the record was not signed.
 */
async function fundAndUploadFolder(
  folderName: string,
  files: File[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<{ manifestId: string; firstPath: string; listed: boolean }> {
  let manifestId = ''
  let stage: UploadStage = 'free'
  try {
    const irys = await getIrys(url, token, chain)
    await ensureFunded(irys, folderBytes(files), (next) => (stage = next), status)
    status?.('Sign in your wallet, twice: once for the files, once for your record of the folder.')
    const prepared = files.map((file) => {
      const copy = new File([file], file.name, { type: file.type })
      Object.defineProperty(copy, 'webkitRelativePath', { value: pathInFolder(file.webkitRelativePath || file.name) })
      return Object.assign(copy, {
        tags: [
          { name: 'Content-Type', value: file.type || 'application/octet-stream' },
          { name: 'application-id', value: 'MiyaOS' },
        ],
      })
    })
    const receipt = await irys.uploadFolder(prepared)
    manifestId = receipt?.manifestId || ''
    if (!manifestId) throw new Error('The storage service did not return a folder id.')
    const firstPath = prepared[0]?.webkitRelativePath || ''
    try {
      await irys.upload(JSON.stringify({ manifest: manifestId, files: files.length }), {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'application-id', value: 'MiyaOS' },
          { name: 'miya-kind', value: 'folder' },
          { name: 'Folder-Manifest', value: manifestId },
          { name: 'Folder-Name', value: folderName.slice(0, MAX_NAME) },
          { name: 'File-Count', value: String(files.length) },
        ],
      })
      return { manifestId, firstPath, listed: true }
    } catch (e) {
      console.error('Folder record failed', e)
      return { manifestId, firstPath, listed: false }
    }
  } catch (e) {
    throw uploadError(e, stage)
  }
}

async function fundAndUploadSingleFile(
  file: File,
  tags: Tag[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<string> {
  let stage: UploadStage = 'free'
  try {
    const irys = await getIrys(url, token, chain)
    await ensureFunded(irys, file.size, (next) => (stage = next), status)
    status?.('Sign the upload in your wallet.')
    // The name is what "Your uploads" shows later. It is public, like the rest of the tags.
    const named = file.name ? [...tags, { name: 'File-Name', value: file.name.slice(0, MAX_NAME) }] : tags
    const receipt = await irys.uploadFile(file, { tags: named })
    console.log(`Uploaded successfully. ${GATEWAY_BASE}${receipt.id}`)
    return receipt.id
  } catch (e) {
    throw uploadError(e, stage)
  }
}

/**
 * Pays once for every file about to be stored, before the first upload: one Ethereum payment and one wait, not one per
 * file. Each upload after it finds its price covered and pays nothing more. Keeps the same memory of a payment on its
 * way, so a retry never pays twice. Throws an Error with plain words when it cannot finish.
 */
async function fundStorage(sizes: readonly number[], url?: string, token?: string, chain?: Chain, status?: UploadStatus) {
  let stage: UploadStage = 'free'
  try {
    const irys = await getIrys(url, token, chain)
    await ensureFunded(irys, sizes, (next) => (stage = next), status)
  } catch (e) {
    throw uploadError(e, stage)
  }
}

/** Pays Irys if needed, then uploads. Throws an Error with plain words when it cannot finish. */
const fundAndUpload = fundAndUploadSingleFile

export { fundAndUpload, fundAndUploadFolder, fundStorage }
