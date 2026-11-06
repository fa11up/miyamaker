import type { WebIrys } from '@irys/sdk'
import type { Chain } from 'viem'

import getIrys from './getIrys'
import { pathInFolder } from './myUploads'

type Tag = {
  name: string
  value: string
}

const GATEWAY_BASE = (import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/').endsWith('/')
  ? import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'
  : `${import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'}/`

export type UploadStatus = (words: string) => void

/** Pay a little over the price, so a small price move between paying and uploading does not fail the upload. */
export const PRICE_MARGIN = 1.1
/** Irys stores files up to 100 KiB free; leave room for the signature and tags. */
export const FREE_BYTES = 90 * 1024
const CREDIT_POLL_MS = 10_000
const CREDIT_WAIT_MS = 15 * 60_000

/** Plain words for what went wrong; the raw error stays in the console. */
function uploadError(e: unknown): Error {
  const raw = String((e as { shortMessage?: string })?.shortMessage || (e as Error)?.message || e)
  console.error('Upload failed', e)
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(raw))
    return new Error('You cancelled it in your wallet. Nothing was uploaded.')
  if (/insufficient funds|exceeds the balance/i.test(raw))
    return new Error('This wallet needs a little more ETH on Ethereum to pay for storage and gas.')
  if (/402|not enough/i.test(raw))
    return new Error(
      'Irys has not counted your storage payment yet. Try again in a few minutes; you will not pay twice.'
    )
  return new Error(`The upload did not go through: ${raw.split('\n')[0]!.slice(0, 160)}`)
}

/**
 * Make sure Irys holds enough of this wallet's money for `size` bytes. On Ethereum a payment takes minutes to be
 * credited, so after paying this waits for it rather than uploading into a "not enough funds". What was paid stays
 * on the wallet's Irys balance, so trying again after a timeout does not pay again.
 */
async function ensureFunded(irys: WebIrys, size: number, status?: UploadStatus) {
  if (size <= FREE_BYTES) return
  const price = await irys.getPrice(size)
  const balance = await irys.getLoadedBalance()
  if (balance.isGreaterThan(price)) return
  status?.('Pay for storage in your wallet (once, on Ethereum).')
  await irys.fund(price.multipliedBy(PRICE_MARGIN).minus(balance).integerValue())
  status?.('Waiting for Irys to count your payment. This can take a few minutes.')
  const deadline = Date.now() + CREDIT_WAIT_MS
  // eslint-disable-next-line no-await-in-loop
  while (!(await irys.getLoadedBalance()).isGreaterThanOrEqualTo(price)) {
    if (Date.now() > deadline) throw new Error('402: not enough funds yet')
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, CREDIT_POLL_MS)
    })
  }
}

/** Room for what a bundle adds to its files: each item's header and the folder's manifest. */
const BUNDLE_BYTES_PER_FILE = 2048
const MAX_NAME = 200

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
  try {
    const irys = await getIrys(url, token, chain)
    const size = files.reduce((sum, file) => sum + file.size + BUNDLE_BYTES_PER_FILE, 0)
    await ensureFunded(irys, size, status)
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
    if (!manifestId) throw new Error('Irys did not return a folder id.')
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
    throw uploadError(e)
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
  try {
    const irys = await getIrys(url, token, chain)
    await ensureFunded(irys, file.size, status)
    status?.('Sign the upload in your wallet.')
    // The name is what "Your uploads" shows later. It is public, like the rest of the tags.
    const named = file.name ? [...tags, { name: 'File-Name', value: file.name.slice(0, MAX_NAME) }] : tags
    const receipt = await irys.uploadFile(file, { tags: named })
    console.log(`Uploaded successfully. ${GATEWAY_BASE}${receipt.id}`)
    return receipt.id
  } catch (e) {
    throw uploadError(e)
  }
}

/** Pays Irys if needed, then uploads. Throws an Error with plain words when it cannot finish. */
const fundAndUpload = fundAndUploadSingleFile

export { fundAndUpload, fundAndUploadFolder }
