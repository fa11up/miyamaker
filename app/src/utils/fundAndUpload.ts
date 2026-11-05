import type { WebIrys } from '@irys/sdk'
import type { Chain } from 'viem'

import getIrys from './getIrys'

type Tag = {
  name: string
  value: string
}

const GATEWAY_BASE = (import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/').endsWith('/')
  ? import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'
  : `${import.meta.env.VITE_IRYS_GATEWAY || 'https://gateway.irys.xyz/'}/`

export type UploadStatus = (words: string) => void

/** Pay a little over the price, so a small price move between paying and uploading does not fail the upload. */
const PRICE_MARGIN = 1.1
/** Irys stores files up to 100 KiB free; leave room for the signature and tags. */
const FREE_BYTES = 90 * 1024
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

// Function Overloading
async function fundAndUploadMultipleFiles(
  files: File[],
  tags: Tag[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<string[]> {
  try {
    const irys = await getIrys(url, token, chain)
    await ensureFunded(
      irys,
      files.reduce((size, file) => size + file.size, 0),
      status
    )
    status?.('Sign the upload in your wallet.')
    const receipt = await irys.uploadFolder(files, {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      tags,
    })
    console.log(`Uploaded successfully. ${GATEWAY_BASE}${receipt.manifestId}`)
    return [receipt?.manifestId || '', receipt?.id || '']
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
    const receipt = await irys.uploadFile(file, { tags })
    console.log(`Uploaded successfully. ${GATEWAY_BASE}${receipt.id}`)
    return receipt.id
  } catch (e) {
    throw uploadError(e)
  }
}

/** Pays Irys if needed, then uploads. Throws an Error with plain words when it cannot finish. */
async function fundAndUpload(
  file: File,
  tags: Tag[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<string>
async function fundAndUpload(
  files: File[],
  tags: Tag[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<string[]>
async function fundAndUpload(
  files: File | File[],
  tags: Tag[],
  url?: string,
  token?: string,
  chain?: Chain,
  status?: UploadStatus
): Promise<string | string[]> {
  if (Array.isArray(files)) {
    return fundAndUploadMultipleFiles(files, tags, url, token, chain, status)
  }

  return fundAndUploadSingleFile(files, tags, url, token, chain, status)
}

export { fundAndUpload }
