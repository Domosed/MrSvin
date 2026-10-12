export interface VoiceDraft { id: string; audio: Blob; seconds: number; createdAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mrmak-mobile-voice', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('recordings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Could not save the recording on this phone.'))
  })
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', mode), request = action(tx.objectStore('recordings'))
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not save the recording on this phone.')) }
  })
}
export const readVoiceDraft = (chat: string) => transaction<VoiceDraft | undefined>('readonly', store => store.get(chat))
export const saveVoiceDraft = (chat: string, draft: VoiceDraft) => transaction('readwrite', store => store.put(draft, chat))
export const deleteVoiceDraft = (chat: string) => transaction('readwrite', store => store.delete(chat))
export const clearVoiceDrafts = () => transaction('readwrite', store => store.clear())
