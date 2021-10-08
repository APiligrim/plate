import * as React from "react";
import * as UploadUtilities from "~/common/upload-utilities";
import * as FileUtilities from "~/common/file-utilities";

import { useEventListener } from "~/common/hooks";

const UploadContext = React.createContext({});
export const useUploadContext = () => React.useContext(UploadContext);

export const Provider = ({ children, page, data, viewer }) => {
  const [uploadState, uploadHandlers] = useUpload({});

  const [isUploadJumperVisible, { showUploadJumper, hideUploadJumper }] = useUploadJumper();

  useUploadOnDrop({ upload: uploadHandlers.upload, page, data, viewer });

  useUploadFromClipboard({ upload: uploadHandlers.upload, page, data, viewer });

  useEventListener("open-upload-jumper", showUploadJumper);

  const providerValue = React.useMemo(
    () => [
      { ...uploadState, isUploadJumperVisible },
      {
        ...uploadHandlers,
        showUploadJumper,
        hideUploadJumper,
      },
    ],
    [uploadHandlers, uploadState, isUploadJumperVisible]
  );

  return <UploadContext.Provider value={providerValue}>{children}</UploadContext.Provider>;
};

const useUploadJumper = () => {
  const [isUploadJumperVisible, setUploadJumperState] = React.useState(false);
  const showUploadJumper = () => setUploadJumperState(true);
  const hideUploadJumper = () => setUploadJumperState(false);
  return [isUploadJumperVisible, { showUploadJumper, hideUploadJumper }];
};

const useUpload = () => {
  const DEFAULT_STATE = {
    fileLoading: {},
    isUploading: false,
    totalBytesUploaded: 0,
    totalBytes: 0,
    totalFilesUploaded: 0,
    totalFiles: 0,
    isFinished: false,
  };

  const [uploadState, setUploadState] = React.useState(DEFAULT_STATE);

  const uploadProvider = React.useMemo(() => {
    const handleStartUploading = () => {
      setUploadState((prev) => ({ ...prev, isFinished: false, isUploading: true }));
    };

    const handleFinishUploading = () => {
      setUploadState((prev) => ({
        ...DEFAULT_STATE,
        fileLoading: prev.fileLoading,
        isFinished: true,
      }));
    };

    const handleAddToQueue = (file) => {
      const fileKey = UploadUtilities.getFileKey(file);
      setUploadState((prev) => ({
        ...prev,
        fileLoading: {
          ...prev.fileLoading,
          [fileKey]: {
            id: fileKey,
            status: "saving",
            name: file.name,
            type: file.type,
            createdAt: Date.now(),
            loaded: 0,
            total: file.size,
            blob: file,
          },
        },
        totalFiles: prev.totalFiles + 1,
        totalBytes: prev.totalBytes + file.size,
      }));
    };

    const handleSuccess = ({ fileKey, cid }) => {
      setUploadState((prev) => {
        const newFileLoading = { ...prev.fileLoading };
        newFileLoading[fileKey].status = "saved";
        newFileLoading[fileKey].cid = cid;
        return {
          ...prev,
          fileLoading: newFileLoading,
          totalFilesUploaded: prev.totalFilesUploaded + 1,
        };
      });
    };

    const handleDuplicate = ({ fileKey, cid }) => {
      setUploadState((prev) => {
        const newFileLoading = { ...prev.fileLoading };
        newFileLoading[fileKey].status = "duplicate";
        newFileLoading[fileKey].cid = cid;
        return {
          ...prev,
          fileLoading: newFileLoading,
          totalFilesUploaded: prev.totalFilesUploaded + 1,
        };
      });
    };

    const handleProgress = ({ fileKey, loaded }) => {
      setUploadState((prev) => {
        const newFileLoading = { ...prev.fileLoading };
        const bytesLoaded = loaded - newFileLoading[fileKey].loaded;
        newFileLoading[fileKey].loaded = loaded;
        return {
          ...prev,
          fileLoading: newFileLoading,
          totalBytesUploaded: prev.totalBytesUploaded + bytesLoaded,
        };
      });
    };

    const handleError = ({ fileKey }) => {
      setUploadState((prev) => {
        const newFileLoading = { ...prev.fileLoading };
        newFileLoading[fileKey].status = "failed";
        return {
          ...prev,
          fileLoading: newFileLoading,
          totalFiles: prev.totalFiles - 1,
          totalBytes: prev.totalBytes - newFileLoading[fileKey].total,
          totalBytesUploaded: prev.totalBytesUploaded - newFileLoading[fileKey].total,
        };
      });
    };

    const handleCancelUploading = ({ fileKeys }) => {
      setUploadState((prev) => {
        const newFileLoading = { ...prev.fileLoading };
        const newTotalFiles = prev.totalFiles - fileKeys.length;
        let newTotalBytes = prev.totalBytes;
        let newTotalBytesUploaded = prev.totalBytesUploaded;

        fileKeys.forEach((fileKey) => {
          newTotalBytes -= newFileLoading[fileKey].total;
          newTotalBytesUploaded -= newFileLoading[fileKey].loaded;
          delete newFileLoading[fileKey];
        });

        return {
          ...prev,
          fileLoading: newFileLoading,
          totalFiles: newTotalFiles,
          totalBytes: newTotalBytes,
          totalBytesUploaded: newTotalBytesUploaded,
        };
      });
    };

    return UploadUtilities.createUploadProvider({
      onStart: handleStartUploading,
      onFinish: handleFinishUploading,
      onAddedToQueue: handleAddToQueue,
      onSuccess: handleSuccess,
      onDuplicate: handleDuplicate,
      onProgress: handleProgress,
      onCancel: handleCancelUploading,
      onError: handleError,
    });
  }, []);

  const resetUploadState = () => (uploadProvider.clearUploadCache(), setUploadState(DEFAULT_STATE));

  return [
    uploadState,
    {
      upload: uploadProvider.upload,
      uploadLink: uploadProvider.uploadLink,
      retry: uploadProvider.retry,
      retryAll: uploadProvider.retryAll,
      cancel: uploadProvider.cancel,
      cancelAll: uploadProvider.cancelAll,
      resetUploadState,
    },
  ];
};

const useUploadOnDrop = ({ upload, page, data, viewer }) => {
  const handleDragEnter = (e) => e.preventDefault();
  const handleDragLeave = (e) => e.preventDefault();
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = async (e) => {
    e.preventDefault();

    const { files, error } = await FileUtilities.formatDroppedFiles({
      dataTransfer: e.dataTransfer,
    });

    if (error) {
      return null;
    }

    let slate = null;
    if (page?.id === "NAV_SLATE" && data?.ownerId === viewer?.id) {
      slate = data;
    }

    upload({ files, slate });
  };

  useEventListener("dragenter", handleDragEnter, []);
  useEventListener("dragleave", handleDragLeave, []);
  useEventListener("dragover", handleDragOver, []);
  useEventListener("drop", handleDrop, []);
};

const useUploadFromClipboard = ({ upload, page, data, viewer }) => {
  const handlePaste = (e) => {
    const clipboardItems = e.clipboardData.items || [];
    if (!clipboardItems) return;

    const { files } = FileUtilities.formatPastedImages({
      clipboardItems,
    });

    let slate = null;
    if (page?.id === "NAV_SLATE" && data?.ownerId === viewer?.id) {
      slate = data;
    }
    upload({ files, slate });
  };

  useEventListener("paste", handlePaste);
};
