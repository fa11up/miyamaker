// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components/macro'
import { useAccount } from 'wagmi'

import SearchDirectory from '@/assets/search_directory.png'
import { ConnectedButton, LinkButton } from '@/components/Button'
import { StatusBox } from '@/components/Retro'
import { Spinner } from '@/components/Spinner'
import { formatBytes } from '@/utils/formatBytes'
import { folderBytes, fundAndUpload, fundAndUploadFolder } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'
import { isJunkFile } from '@/utils/myUploads'
import { useStorageQuote } from '@/utils/useStorageQuote'

interface ProgressBarUploaderProps {
  /** The element that takes dropped files. Defaults to the uploader itself. */
  dropArea?: RefObject<HTMLElement>
  onBusyChange?: (busy: boolean) => void
}

const FlexContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
`

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const ButtonContainer = styled.div`
  display: flex;
  margin-top: auto;
  width: 100%;
  justify-content: end;
  align-items: center;
  gap: 1rem;
`
const DashedBorderContainer = styled.div`
  border-width: 1px;
  border-style: dotted;
  background-color: rgba(238, 240, 246, 0.4);
  border-color: black;
  padding: 1rem;
  text-align: center;
  z-index: 50;

  &[data-dragging='true'] {
    border-width: 2px;
    border-style: dashed;
    border-color: #e901b7;
    background-color: rgba(233, 1, 183, 0.12);
  }
`

/* A phone has nothing to drag from, so it only gets Browse. */
const DragWords = styled.p`
  @media (max-width: 640px), (hover: none) {
    display: none;
  }
`

const PriceLine = styled.p`
  margin: 0;
  line-height: 1.4;
`

const stripes = keyframes`
  to {
    background-position: 36px 0;
  }
`

/* The storage service reports no progress, so this says only that the work is still going. */
const BusyBar = styled.div`
  height: 16px;
  padding: 2px;
  box-shadow: inset -2px -2px #dfdfdf, inset 2px 2px #808080;

  > span {
    display: block;
    height: 100%;
    background-image: linear-gradient(90deg, #e901b7 0 16px, transparent 0 18px);
    background-size: 18px 100%;
    animation: ${stripes} 900ms linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    > span {
      animation: none;
    }
  }
`

const Message = styled(StatusBox)`
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
  > span {
    flex: 1 1 12rem;
    min-width: 0;
  }
`

const FileRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
`

const FileButtonRow = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`
type Folder = { name: string; files: File[]; size: number }

/** Everything is held in the browser while it is signed and sent, so a folder has to fit in memory. */
const MAX_FOLDER_BYTES = 500 * 1024 * 1024
const MAX_FOLDER_FILES = 2000

const makeFolder = (name: string, all: File[]): Folder => {
  const files = all.filter((f) => f.size > 0 && !isJunkFile(f.webkitRelativePath || f.name))
  return { name, files, size: files.reduce((sum, f) => sum + f.size, 0) }
}

/** Several loose files go up together as one folder. Paths get a top level, which pathInFolder takes back off. */
const groupFiles = (files: File[]): Folder => {
  const grouped = files.map((file) => {
    const copy = new File([file], file.name, { type: file.type })
    Object.defineProperty(copy, 'webkitRelativePath', { value: `group/${file.webkitRelativePath || file.name}` })
    return copy
  })
  return makeFolder('Uploaded together', grouped)
}

const folderProblem = (folder: Folder) => {
  if (!folder.files.length) return 'That folder has no files to store.'
  if (folder.files.length > MAX_FOLDER_FILES) return `A folder can hold up to ${MAX_FOLDER_FILES} files.`
  if (folder.size > MAX_FOLDER_BYTES) return `A folder can be up to ${formatBytes(MAX_FOLDER_BYTES)}.`
  return ''
}

/** A dropped folder's files, with their paths written the way a folder picker gives them. */
async function readDropped(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') })
    return [file]
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const found: File[] = []
  // readEntries gives a batch at a time, and an empty one at the end.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) return found
    // eslint-disable-next-line no-await-in-loop
    for (const child of batch) found.push(...(await readDropped(child)))
  }
}

type Status = { tone: 'info' | 'ok' | 'error'; words: string; copy?: string }

export const ProgressBarUploader = ({ dropArea, onBusyChange }: ProgressBarUploaderProps) => {
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined)
  const [selectedFolder, setSelectedFolder] = useState<Folder>()
  const [choosing, setChoosing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [fileUrl, setFileUrl] = useState<string>('')
  const [txProcessing, setTxProcessing] = useState<boolean>(false)
  const processing = useRef(false)
  processing.current = txProcessing
  const [message, setMessage] = useState<Status>()
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const own = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line unused-imports/no-unused-vars
  const [uploadTxId, setUploadTxId] = useState<string | null>(null)

  const { chain, isConnected } = useAccount()
  // Gone from the screen: no more wallet prompts. fundAndUpload says what it is about to ask before each one, so
  // throwing here stops it between them. Reset on mount for React's double effects in development.
  const left = useRef(false)
  useEffect(() => {
    left.current = false
    return () => {
      left.current = true
    }
  }, [])
  const showStatus = (words: string) => {
    if (left.current) throw new Error('The window was closed, so this stopped.')
    setMessage({ tone: 'info', words })
  }

  useEffect(() => onBusyChange?.(txProcessing), [txProcessing, onBusyChange])

  const problem = selectedFolder ? folderProblem(selectedFolder) : ''
  const chosenBytes = selectedFolder ? folderBytes(selectedFolder.files) : selectedFile?.size
  const quote = useStorageQuote(problem ? undefined : chosenBytes)
  const chosen = !!selectedFile || !!selectedFolder

  const GATEWAY_BASE = (import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/').endsWith('/')
    ? import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'
    : `${import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'}/`

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    // Choosing the same file again should still fire a change.
    event.target.value = ''
    setChoosing(false)
    if (picked.length > 1) {
      pickFolder(groupFiles(picked))
      return
    }
    setMessage(undefined)
    setSelectedFile(undefined)
    setSelectedFolder(undefined)
    setFileUrl('')
    if (picked[0]) setSelectedFile(picked[0])
  }

  // Cancelling a file dialog fires no change, and would leave Files and Folder up in place of Browse.
  useEffect(() => {
    const inputs = [fileInput.current, folderInput.current]
    const back = () => setChoosing(false)
    inputs.forEach((input) => input?.addEventListener('cancel', back))
    return () => inputs.forEach((input) => input?.removeEventListener('cancel', back))
  }, [])

  const pickFolder = (folder: Folder) => {
    const trouble = folderProblem(folder)
    setFileUrl('')
    setSelectedFile(undefined)
    setSelectedFolder(folder)
    setMessage(trouble ? { tone: 'error', words: trouble } : undefined)
  }

  /** After a finished upload the choice is cleared, so pressing the button can never pay for the same thing twice. */
  const startOver = () => {
    setSelectedFile(undefined)
    setSelectedFolder(undefined)
    setFileUrl('')
    setMessage(undefined)
    setCopied(false)
    setChoosing(false)
  }

  /** Files or a folder when the device can pick a folder; a phone goes straight to files. */
  const browse = () => {
    const folderless = window.matchMedia?.('(hover: none)').matches
    if (folderless) fileInput.current?.click()
    else setChoosing(true)
  }

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(event.target.files || [])
    setChoosing(false)
    if (!all.length) return
    pickFolder(makeFolder((all[0]?.webkitRelativePath || '').split('/')[0] || 'Folder', all))
    // Choosing the same folder again should still fire a change.
    event.target.value = ''
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    if (!event.dataTransfer || txProcessing) return
    setChoosing(false)
    const loose = Array.from(event.dataTransfer.files)
    if (!loose.length) return
    // The drop's contents are gone after the first await, so take the entries now.
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry)
    if (entries.some((entry) => entry.isDirectory)) {
      let read: File[]
      try {
        read = (await Promise.all(entries.map(readDropped))).flat()
      } catch {
        setMessage({ tone: 'error', words: "Couldn't read that folder. Try it again, or use Browse." })
        return
      }
      // A big folder takes a while, and an upload may have started meanwhile: it must not change under that.
      if (processing.current) return
      const only = entries.length === 1 ? entries[0] : undefined
      pickFolder(only ? makeFolder(only.name, read) : groupFiles(read))
      return
    }
    if (loose.length > 1) {
      pickFolder(groupFiles(loose))
      return
    }
    setMessage(undefined)
    setFileUrl('')
    setSelectedFolder(undefined)
    setSelectedFile(loose[0])
  }

  // A file let go anywhere else would make the browser leave miyaOS and open it.
  const dropHandler = useRef(handleDrop)
  dropHandler.current = handleDrop
  useEffect(() => {
    const area = dropArea?.current ?? own.current
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const hold = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (hasFiles(e)) dropHandler.current(e)
    }
    window.addEventListener('dragover', hold)
    window.addEventListener('drop', hold)
    area?.addEventListener('dragenter', enter)
    area?.addEventListener('dragleave', leave)
    area?.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', hold)
      window.removeEventListener('drop', hold)
      area?.removeEventListener('dragenter', enter)
      area?.removeEventListener('dragleave', leave)
      area?.removeEventListener('drop', drop)
    }
  }, [dropArea])

  const uploadFolder = async (folder: Folder) => {
    setTxProcessing(true)
    try {
      const { manifestId, firstPath, listed } = await fundAndUploadFolder(
        folder.name,
        folder.files,
        undefined,
        getIrysToken(chain?.id || 1),
        chain,
        showStatus
      )
      const address = `ar://${manifestId}/`
      setFileUrl(`${GATEWAY_BASE}${manifestId}/${firstPath}`)
      setMessage({
        tone: 'ok',
        copy: address,
        words: listed
          ? `Stored for good: ${address}`
          : `Stored: ${address} The second signature was skipped, so it will not show in Your uploads.`,
      })
    } catch (e) {
      setMessage({ tone: 'error', words: (e as Error).message })
    } finally {
      setTxProcessing(false)
    }
  }

  const handleUpload = async () => {
    if (txProcessing || fileUrl) return
    setMessage(undefined)
    setCopied(false)
    if (selectedFolder) {
      if (!problem) await uploadFolder(selectedFolder)
      return
    }
    if (!selectedFile) return

    setTxProcessing(true)

    let res: string
    try {
      res = await fundAndUpload(
        selectedFile,
        [
          { name: 'Content-Type', value: selectedFile.type },
          { name: 'application-id', value: 'MiyaOS' },
        ],
        undefined,
        getIrysToken(chain?.id || 1),
        chain,
        showStatus
      )
    } catch (e) {
      setMessage({ tone: 'error', words: (e as Error).message })
      setTxProcessing(false)
      return
    }

    setMessage({ tone: 'ok', copy: `ar://${res}`, words: `Stored for good: ar://${res}` })

    setUploadTxId(res)
    setFileUrl(`${GATEWAY_BASE}${res}`)

    /*
    const irys = await getIrys()
    const uploader = irys.uploader.chunkedUploader
    // Change the batch size to 1 to make testing easier (default is 5)
    uploader.setBatchSize(1)
    // Change the chunk size to something small to make testing easier (default is 25MB)
    const chunkSize = 2000000
    uploader.setChunkSize(chunkSize)

    // Get a create a streamed reader
    const dataStream = fileReaderStream(selectedFile)
    // save a reference to the file size

    // Divide the total file size by the size of each chunk we'll upload
    if (selectedFile?.size < chunkSize) totalChunks.current = 1
    else {
      totalChunks.current = Math.floor((selectedFile?.size || 0) / chunkSize)
    }

    // Event callback chunkUpload: called for every chunk uploaded
    uploader.on('chunkUpload', (chunkInfo) => {
      console.log(chunkInfo)
      console.log(
        `Uploaded Chunk number ${chunkInfo.id}, offset of ${chunkInfo.offset}, size ${chunkInfo.size} Bytes, with a total of ${chunkInfo.totalUploaded} bytes uploaded.`
      )

      const chunkNumber = chunkInfo.id + 1
      // update the progress bar based on how much has been uploaded
      if (chunkNumber >= totalChunks.current) setProgress(100)
      else setProgress((chunkNumber / totalChunks.current) * 100)
    })

    // Event callback: called if an error happens
    uploader.on('chunkError', (e) => {
      console.error(`Error uploading chunk number ${e.id} - ${e.res.statusText}`)
    })

    // Event callback: called when file is fully uploaded
    uploader.on('done', (finishRes) => {
      console.log(`Upload completed with ID ${finishRes.id}`)
      // Set the progress bar to 100
      setProgress(100)
    })

    // Upload the file
    await uploader
      .uploadData(dataStream, {
        tags: [{ name: 'Content-Type', value: fileType }],
        upload: { getReceiptSignature: true },
      })
      .then((res) => {
        console.log(res)
        setUploadTxId(res.data.id)
        setFileUrl(`${GATEWAY_BASE}${res.data.id}`)
      })
      .catch((e) => {
        setMessage(`Upload error ${e.message}`)
        console.log('error on upload, ', e)
      })
      */
    setTxProcessing(false)
  }

  const copyAddress = async (address: string) => {
    await navigator.clipboard?.writeText(address)
    setCopied(true)
  }

  const paid = quote.state === 'priced' || quote.state === 'failed'
  const priceWords =
    quote.state === 'free'
      ? 'Free. This one is small enough.'
      : quote.state === 'loading'
        ? 'Checking the price…'
        : quote.state === 'failed'
          ? "Couldn't get the price. Your wallet shows it before you pay."
          : quote.state === 'priced'
            ? `Storage: ${quote.words}, plus Ethereum gas. Paid once. A little extra stays on your storage balance for next time.`
            : ''

  return (
    <FlexContainer ref={own}>
      <TextContainer>
        <p>Store files or folders for good on Arweave, a permanent storage network.</p>
        <p>Anyone can see what you upload, including its name. It can never be deleted.</p>
      </TextContainer>
      <DashedBorderContainer data-dragging={dragging}>
        <DragWords>
          {dragging ? 'Drop to add' : 'Drag and drop files or a folder here'}
        </DragWords>
        <input ref={fileInput} type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
        <input
          ref={folderInput}
          type="file"
          // @ts-expect-error not in React's input attributes
          webkitdirectory=""
          multiple
          onChange={handleFolderUpload}
          style={{ display: 'none' }}
        />
        {/* A browser's file dialog picks files or a folder, never both, so Browse asks which. */}
        {choosing ? (
          <>
            <button disabled={txProcessing} onClick={() => fileInput.current?.click()}>
              Files
            </button>
            <button disabled={txProcessing} style={{ marginLeft: '0.5rem' }} onClick={() => folderInput.current?.click()}>
              Folder
            </button>
          </>
        ) : (
          <button disabled={txProcessing} onClick={browse}>
            Browse
          </button>
        )}
      </DashedBorderContainer>

      {chosen && (
        <FileRow>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {selectedFolder
              ? `${selectedFolder.name}/ ${selectedFolder.files.length} file${
                  selectedFolder.files.length === 1 ? '' : 's'
                }, ${formatBytes(selectedFolder.size)}`
              : selectedFile && `${selectedFile.name} ${formatBytes(selectedFile.size)}`}
          </span>
          <FileButtonRow>
            {fileUrl && (
              <LinkButton target="_blank" rel="noreferrer noopener" href={fileUrl} style={{ gap: '0.5rem' }}>
                <img src={SearchDirectory} alt="" style={{ width: '16px', border: 'none' }} /> Check upload
              </LinkButton>
            )}
          </FileButtonRow>
        </FileRow>
      )}
      {chosen && !fileUrl && priceWords && <PriceLine>{priceWords}</PriceLine>}
      {message && (
        <Message tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>
          <span>{message.words}</span>
          {message.copy && <button onClick={() => copyAddress(message.copy as string)}>{copied ? 'Copied' : 'Copy'}</button>}
        </Message>
      )}
      {txProcessing && (
        <BusyBar aria-hidden>
          <span />
        </BusyBar>
      )}
      <ButtonContainer>
        {fileUrl ? (
          <button onClick={startOver}>Upload another</button>
        ) : (
          <ConnectedButton
            onClick={handleUpload}
            // Connecting a wallet is always allowed; only the upload itself waits for something to send and its price.
            disabled={txProcessing || (isConnected && (!chosen || !!problem || quote.state === 'loading'))}
          >
            {txProcessing ? (
              <>
                <Spinner /> Uploading
              </>
            ) : paid ? (
              'Upload and pay'
            ) : (
              'Upload'
            )}
          </ConnectedButton>
        )}
      </ButtonContainer>
    </FlexContainer>
  )
}

export default ProgressBarUploader

/* 
USAGE:
- Default (shows the preview): 
  <ProgressBarUploader />

- To hide the preview:
  <ProgressBarUploader showPreview={false} />

Note:
* If `showPreview` is not provided, the component defaults to showing the preview.
*/
