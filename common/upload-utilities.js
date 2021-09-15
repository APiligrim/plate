import * as FileUtilities from "~/common/file-utilities";
import * as Logging from "~/common/logging";
import * as Actions from "~/common/actions";

// NOTE(amine): utilities
export const getFileKey = ({ lastModified, name }) => `${lastModified}-${name}`;

let UploadStore = {
  queue: [],
  failedFilesCache: {},
  isUploading: false,
  duplicates: {},
};

let UploadAbort = {
  currentUploadingFile: null,
  abort: null,
};

// NOTE(amine): queue utilities
const getUploadQueue = () => UploadStore.queue;
const pushToUploadQueue = ({ file, slate, bucket }) =>
  UploadStore.queue.push({ file, slate, bucket });
const resetUploadQueue = () => (UploadStore.queue = []);
const removeFromUploadQueue = ({ fileKey }) =>
  (UploadStore.queue = UploadStore.queue.filter(({ file }) => getFileKey(file) !== fileKey));

// NOTE(amine): failedFilesCache utilities
const storeFileInCache = ({ file, slate, bucketName }) =>
  (UploadStore.failedFilesCache[getFileKey(file)] = { file, slate, bucketName });
const removeFileFromCache = ({ fileKey }) => delete UploadStore.failedFilesCache[fileKey];
const getFileFromCache = ({ fileKey }) => UploadStore.failedFilesCache[fileKey] || {};

// NOTE(amine): UploadAbort utilities
const registerFileUploading = ({ fileKey }) => (UploadAbort.currentUploadingFile = fileKey);
const resetAbortUploadState = () => (UploadAbort = { currentUploadingFile: null, abort: null });
const abortCurrentFileUpload = () => UploadAbort.abort();
const canCurrentFileBeAborted = () => UploadAbort.currentUploadingFile && UploadAbort.abort;
const isFileCurrentlyUploading = ({ fileKey }) =>
  fileKey === UploadAbort.currentUploadingFile && UploadAbort.abort;

// NOTE(amine): upload factory function
export function createUploadProvider({
  onStart,
  onFinish,
  onAddedToQueue,
  onProgress,
  onSuccess,
  onError,
  onCancel,
  onDuplicate,
}) {
  const scheduleQueueUpload = async () => {
    const uploadQueue = getUploadQueue();
    if (UploadStore.isUploading || uploadQueue.length === 0) return;

    const { file, slate, bucketName } = getUploadQueue().shift() || {};

    const fileKey = getFileKey(file);

    UploadStore.isUploading = true;
    registerFileUploading({ fileKey });

    try {
      let response = await FileUtilities.upload({
        file,
        bucketName,
        uploadAbort: UploadAbort,
        onProgress: (e) => onProgress({ fileKey, loaded: e.loaded }),
      });

      if (!response.aborted) {
        if (!response || response.error) throw new Error(response);
        // TODO(amine): merge createFile and upload endpoints
        let createResponse = await Actions.createFile({ files: [response], slate });
        if (!createResponse || createResponse.error) throw new Error(response);

        const isDuplicate = createResponse?.data?.skipped > 0;
        if (isDuplicate) {
          UploadStore.duplicates[fileKey] = true;
          if (onDuplicate) onDuplicate({ fileKey, cid: createResponse.data?.cid });
        } else {
          if (onSuccess) onSuccess({ fileKey });
        }
      }
    } catch (e) {
      storeFileInCache({ file, slate, bucketName });

      if (onError) onError({ fileKey });
      Logging.error(e);
    }

    UploadStore.isUploading = false;
    resetAbortUploadState();

    const isQueueEmpty = getUploadQueue().length === 0;
    if (!isQueueEmpty) {
      scheduleQueueUpload();
      return;
    }

    if (onFinish) onFinish();
  };

  const addToUploadQueue = ({ files, slate, bucketName }) => {
    if (!files || !files.length) return;

    for (let i = 0; i < files.length; i++) {
      const fileKey = getFileKey(files[i]);
      const doesQueueIncludeFile = getUploadQueue().some(
        ({ file }) => getFileKey(files[i]) === getFileKey(file)
      );
      const isDuplicate = fileKey in UploadStore.duplicates;
      // NOTE(amine): skip the file if already uploaded or is a duplicate
      if (doesQueueIncludeFile || isDuplicate) continue;

      // NOTE(amine): if the added file has failed before, remove it from failedFilesCache
      if (fileKey in UploadStore.failedFilesCache) removeFileFromCache({ fileKey });

      if (onAddedToQueue) onAddedToQueue(files[i]);
      pushToUploadQueue({ file: files[i], slate, bucketName });
    }

    const isQueueEmpty = getUploadQueue().length === 0;
    if (!UploadStore.isUploading && !isQueueEmpty && onStart) {
      onStart();
      scheduleQueueUpload();
    }
  };

  const retry = ({ fileKey }) => {
    const { file, slate, bucketName } = getFileFromCache({ fileKey });
    addToUploadQueue({ files: [file], slate, bucketName });
  };

  const cancel = ({ fileKey }) => {
    if (onCancel) onCancel({ fileKeys: [fileKey] });

    if (isFileCurrentlyUploading({ fileKey })) {
      abortCurrentFileUpload();
      return;
    }

    removeFromUploadQueue({ fileKey });
  };

  const cancelAll = () => {
    const fileKeys = getUploadQueue().map(({ file }) => getFileKey(file));
    if (onCancel) onCancel({ fileKeys: [UploadAbort.currentUploadingFile, ...fileKeys] });

    if (canCurrentFileBeAborted()) abortCurrentFileUpload();
    resetUploadQueue();
  };

  return {
    upload: addToUploadQueue,
    retry,
    cancel,
    cancelAll,
  };
}
