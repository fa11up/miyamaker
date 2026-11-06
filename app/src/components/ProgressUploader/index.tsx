// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'
import { useAccount } from 'wagmi'

import SearchDirectory from '@/assets/search_directory.png'
import { ConnectedButton, LinkButton } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { formatBytes } from '@/utils/formatBytes'
import { fundAndUpload, fundAndUploadFolder } from '@/utils/fundAndUpload'
import getIrysToken from '@/utils/getIrysToken'
import { isJunkFile } from '@/utils/myUploads'

import ProgressBar from '../ProgressBar'

interface ProgressBarUploaderProps {
  request?: { requestFrom: string; timestamp: number; label?: string; result?: any }
  onRequest?: (value: string) => void
}

const FlexContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  height: 100%;
`

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const ButtonContainer = styled.div`
  display: flex;
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

export const ProgressBarUploader = ({ request, onRequest }: ProgressBarUploaderProps) => {
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined)
  const [selectedFolder, setSelectedFolder] = useState<Folder>()
  const [choosing, setChoosing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [fileUrl, setFileUrl] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const [txProcessing, setTxProcessing] = useState<boolean>(false)
  const [message, setMessage] = useState<string>('')

  // eslint-disable-next-line unused-imports/no-unused-vars
  const [uploadTxId, setUploadTxId] = useState<string | null>(null)

  const { chain } = useAccount()

  const GATEWAY_BASE = (import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/').endsWith('/')
    ? import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'
    : `${import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'}/`

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    setChoosing(false)
    if (picked.length > 1) {
      pickFolder(groupFiles(picked))
      event.target.value = ''
      return
    }
    setMessage('')
    setProgress(0)
    setSelectedFile(undefined)
    setSelectedFolder(undefined)
    setFileUrl('')

    if (event.target.files && event.target.files[0]) {
      setSelectedFile(event.target.files[0])
    }
  }

  const pickFolder = (folder: Folder) => {
    setProgress(0)
    setFileUrl('')
    setSelectedFile(undefined)
    setSelectedFolder(folder)
    setMessage(folderProblem(folder))
  }

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(event.target.files || [])
    setChoosing(false)
    if (!all.length) return
    pickFolder(makeFolder((all[0]?.webkitRelativePath || '').split('/')[0] || 'Folder', all))
    // Choosing the same folder again should still fire a change.
    event.target.value = ''
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setChoosing(false)
    const loose = Array.from(event.dataTransfer.files)
    // The drop's contents are gone after the first await, so take the entries now.
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry)
    if (!request && entries.some((entry) => entry.isDirectory)) {
      const read = (await Promise.all(entries.map(readDropped))).flat()
      const only = entries.length === 1 ? entries[0] : undefined
      pickFolder(only ? makeFolder(only.name, read) : groupFiles(read))
      return
    }
    if (!request && loose.length > 1) {
      pickFolder(groupFiles(loose))
      return
    }
    setMessage('')
    setFileUrl('')
    setSelectedFolder(undefined)
    setSelectedFile(loose[0])
  }

  const uploadFolder = async (folder: Folder) => {
    setTxProcessing(true)
    setProgress(0)
    try {
      const { manifestId, firstPath, listed } = await fundAndUploadFolder(
        folder.name,
        folder.files,
        undefined,
        getIrysToken(chain?.id || 1),
        chain,
        setMessage
      )
      setFileUrl(`${GATEWAY_BASE}${manifestId}/${firstPath}`)
      setMessage(
        listed
          ? `Stored for good: ar://${manifestId}/`
          : `Stored: ar://${manifestId}/ The second signature was skipped, so it will not show in Your uploads.`
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setTxProcessing(false)
    }
  }

  useEffect(() => {
    if (request?.label) {
      setMessage(request.label)
    }
  }, [request])

  const handleUpload = async () => {
    setMessage('')
    if (selectedFolder) {
      const problem = folderProblem(selectedFolder)
      if (problem) setMessage(problem)
      else await uploadFolder(selectedFolder)
      return
    }
    // handle your file upload logic here
    if (!selectedFile) {
      setMessage('Please select a file first')
      return
    }

    setTxProcessing(true)
    // Reset the progress bar
    setProgress(0)

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
        setMessage
      )
    } catch (e) {
      setMessage((e as Error).message)
      setTxProcessing(false)
      return
    }

    setMessage('')

    setUploadTxId(res)
    setFileUrl(`${GATEWAY_BASE}${res}`)
    if (request && onRequest) {
      onRequest(res)
    }

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

  return (
    <FlexContainer>
      <TextContainer>
        <p>
          Store files or whole folders <b>forever</b>. Whatever you upload here stays online for good on Arweave, a
          permanent storage network. You pay a small one-time fee from your wallet.
        </p>
        <p>
          Anything you store here shows under Your uploads in Launch. File and folder names are saved publicly with
          them.
        </p>
      </TextContainer>
      <DashedBorderContainer
        className={``}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <p className="text-gray-400 mb-2">Drag and drop files {request ? '' : 'or a folder '}here</p>
        <input ref={fileInput} type="file" multiple={!request} onChange={handleFileUpload} style={{ display: 'none' }} />
        <input
          ref={folderInput}
          type="file"
          // @ts-expect-error not in React's input attributes
          webkitdirectory=""
          multiple
          onChange={handleFolderUpload}
          style={{ display: 'none' }}
        />
        {/* A browser's file dialog picks files or a folder, never both, so Browse asks which. Another app asking
            for one file wants one id back, so it goes straight to files. */}
        {choosing ? (
          <>
            <button onClick={() => fileInput.current?.click()}>Files</button>
            <button style={{ marginLeft: '0.5rem' }} onClick={() => folderInput.current?.click()}>
              Folder
            </button>
          </>
        ) : (
          <button onClick={() => (request ? fileInput.current?.click() : setChoosing(true))}>Browse</button>
        )}
      </DashedBorderContainer>

      {(selectedFile || selectedFolder) && (
        <>
          <FileRow>
            <div key="1" className="flex items-center mb-2 text-background-contrast">
              <span className="mr-2">
                {selectedFolder
                  ? `${selectedFolder.name}/ ${selectedFolder.files.length} file${
                      selectedFolder.files.length === 1 ? '' : 's'
                    }, ${formatBytes(selectedFolder.size)}`
                  : selectedFile && `${selectedFile.name} ${formatBytes(selectedFile.size)}`}
              </span>
            </div>
            <FileButtonRow>
              {fileUrl && (
                <LinkButton target="_blank" rel="noreferrer noopener" href={fileUrl} style={{ gap: '0.5rem' }}>
                  <img src={SearchDirectory} alt="Search file" style={{ width: '16px', border: 'none' }} /> Check upload
                </LinkButton>
              )}
            </FileButtonRow>
          </FileRow>
        </>
      )}
      <div style={{ marginTop: 'auto' }}>
        <ProgressBar width={progress} />
      </div>
      <ButtonContainer>
        {message && (
          <div className="text-red-500" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {message}
          </div>
        )}
        <ConnectedButton onClick={handleUpload} disabled={txProcessing}>
          {txProcessing ? (
            <>
              <Spinner /> Uploading
            </>
          ) : (
            'Upload'
          )}
        </ConnectedButton>
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
