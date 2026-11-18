import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useModels } from "@/contexts/ModelsContext";
import { useProgress } from "@/contexts/ProgressContext";
import { useSubtitleDocument } from "@/contexts/SubtitleDocumentContext";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settings-store";
import { useResolve } from "@/contexts/ResolveContext";
import { useAdobe } from "@/contexts/AdobeContext";
import { useIntegration } from "@/contexts/IntegrationContext";
import { useErrorDialog } from "@/contexts/ErrorDialogContext";
import { ResolveApiError } from "@/api/resolve-api";
import SubSlateCard from "@/components/ui/SubSlateCard";
import type { TranscriptionOptions, EnsureModelsRequest, EnsureModelsResponse } from "@/types";
import { getActiveCensorWords } from "@/censor/merge";
import { TranscriptionPanelView } from "./transcription-panel-view";
import { describeError } from "./utils";
import {
  newBatchQueueItem,
  srtPathForVideo,
  type BatchQueueItem,
} from "./batch-queue";

interface TranscriptionPanelProps {
  onViewSubtitles?: () => void;
  onTranscriptCreated?: () => void | Promise<void>;
  isSubtitleViewerOpen?: boolean;
}

export function TranscriptionPanel({
  onViewSubtitles,
  onTranscriptCreated,
  isSubtitleViewerOpen = false,
}: TranscriptionPanelProps = {}) {
  const {
    subtitles,
    speakers,
    processTranscriptionResults,
    exportSubtitlesAs,
    exportSubtitlesToPath,
    loadSubtitles,
  } = useSubtitleDocument();
  const {
    selectedInputTracksByApp,
    model,
    language,
    translate,
    targetLanguage,
    audioInputMode,
    enableDTW,
    enableForcedAlignment,
    enableGpu,
    enableVad,
    enableDiarize,
    maxSpeakers,
    diarizeBackend,
    textDensity,
    maxLinesPerSubtitle,
    customMaxCharsPerLine,
    customMaxWordsPerLine,
    customDensityUnit,
    textCase,
    removePunctuation,
    enableCensor,
    censorStyle,
    customPrompt,
    transcriptionsCompleted,
    subSlateMilestoneShown,
  } = useSettingsStore(
    useShallow((s) => ({
      selectedInputTracksByApp: s.selectedInputTracksByApp,
      model: s.model,
      language: s.language,
      translate: s.translate,
      targetLanguage: s.targetLanguage,
      audioInputMode: s.audioInputMode,
      enableDTW: s.enableDTW,
      enableForcedAlignment: s.enableForcedAlignment,
      enableGpu: s.enableGpu,
      enableVad: s.enableVad,
      enableDiarize: s.enableDiarize,
      maxSpeakers: s.maxSpeakers,
      diarizeBackend: s.diarizeBackend,
      textDensity: s.textDensity,
      maxLinesPerSubtitle: s.maxLinesPerSubtitle,
      customMaxCharsPerLine: s.customMaxCharsPerLine,
      customMaxWordsPerLine: s.customMaxWordsPerLine,
      customDensityUnit: s.customDensityUnit,
      textCase: s.textCase,
      removePunctuation: s.removePunctuation,
      enableCensor: s.enableCensor,
      censorStyle: s.censorStyle,
      customPrompt: s.customPrompt,
      transcriptionsCompleted: s.transcriptionsCompleted,
      subSlateMilestoneShown: s.subSlateMilestoneShown,
    })),
  );
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const { modelsState, checkDownloadedModels } = useModels();
  const {
    timelineInfo: resolveTimeline,
    refresh: refreshResolve,
    cancelExport: resolveCancelExport,
    isExporting: resolveIsExporting,
    exportProgress: resolveExportProgress,
    setIsExporting: resolveSetIsExporting,
    setExportProgress: resolveSetExportProgress,
    cancelRequestedRef: resolveCancelRequestedRef,
    getSourceAudio: resolveGetSourceAudio,
  } = useResolve();

  const {
    timelineInfo: premiereTimeline,
    refresh: refreshPremiere,
    isExporting: premiereIsExporting,
    exportProgress: premiereExportProgress,
    getSourceAudio: premiereGetSourceAudio,
  } = useAdobe();

  const { selectedIntegration } = useIntegration();

  // Standalone has no timeline: treat it as file mode everywhere in this
  // panel even if a stale persisted setting says otherwise.
  const isStandalone = selectedIntegration === "standalone";
  const effectiveMode: "file" | "timeline" = isStandalone ? "file" : audioInputMode;

  const isPremiereActive =
    selectedIntegration === "premiere" || selectedIntegration === "aftereffects";
  const timelineInfo = isPremiereActive ? premiereTimeline : resolveTimeline;
  const refreshAudioTracks = isPremiereActive ? refreshPremiere : refreshResolve;
  const getSourceAudio = isPremiereActive
    ? premiereGetSourceAudio
    : resolveGetSourceAudio;
  const cancelRequestedRef = resolveCancelRequestedRef;
  const isExporting = isPremiereActive
    ? premiereIsExporting
    : resolveIsExporting;
  const exportProgress = isPremiereActive
    ? premiereExportProgress
    : resolveExportProgress;

  // Senior Pattern: derive active tracks from the app-aware map instead of a global list
  const activeSelectedTracks =
    selectedInputTracksByApp[selectedIntegration] || [];
  const cancelExport = resolveCancelExport; // Fallback for cancel
  const setIsExporting = resolveSetIsExporting; // Fallback
  const setExportProgress = resolveSetExportProgress; // Fallback
  const {
    processingSteps,
    clearProgressSteps,
    completeAllProgressSteps,
    cancelAllProgressSteps,
    updateProgressStep,
    setupEventListeners,
  } = useProgress();
  const { showError } = useErrorDialog();
  const { t: tErr } = useTranslation();
  const { t } = useTranslation();

  const [isProcessing, setIsProcessing] = React.useState(false);
  const [, setTranscriptionProgress] = React.useState(0);
  const [, setLabeledProgress] = React.useState<{
    progress: number;
    type?: string;
    label?: string;
  } | null>(null);
  const [fileInput, setFileInput] = React.useState<string | null>(null);
  const [fileInputSelectionId, setFileInputSelectionId] = React.useState(0);
  const [openModelSelector, setOpenModelSelector] = React.useState(false);
  const [showSubSlate, setShowSubSlate] = React.useState(false);
  // Batch queue (standalone file mode only). A single file behaves exactly
  // as before; 2+ files run sequentially through the same per-file path.
  const [queue, setQueue] = React.useState<BatchQueueItem[]>([]);
  const [batchSummary, setBatchSummary] = React.useState<string | null>(null);
  const [batchProgress, setBatchProgress] = React.useState<string | null>(null);
  const isSmallScreen = useMediaQuery("(max-width: 640px)");
  const progressContainerRef = React.useRef<HTMLDivElement>(null);
  const lastSubtitleLoadKeyRef = React.useRef<string | null>(null);

  const handleSelectedFileChange = React.useCallback((file: string | null) => {
    setFileInput(file);
    setFileInputSelectionId((v) => v + 1);
  }, []);

  const updateQueueItem = React.useCallback(
    (path: string, patch: Partial<BatchQueueItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.path === path ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  /** Append files to the batch queue (dedupe by path). First file becomes the preview. */
  const handleAddFiles = React.useCallback(
    (files: string[]) => {
      const fresh = files.filter((f) => !queue.some((q) => q.path === f));
      if (fresh.length === 0) return;
      setQueue((prev) => [...prev, ...fresh.map(newBatchQueueItem)]);
      setBatchSummary(null);
      if (!fileInput) {
        setFileInput(fresh[0]);
        setFileInputSelectionId((v) => v + 1);
      }
    },
    [queue, fileInput],
  );

  const handleRemoveQueueFile = React.useCallback(
    (path: string) => {
      if (isProcessing) return;
      const next = queue.filter((item) => item.path !== path);
      setQueue(next);
      if (fileInput === path) {
        setFileInput(next[0]?.path ?? null);
        setFileInputSelectionId((v) => v + 1);
      }
      setBatchSummary(null);
    },
    [queue, fileInput, isProcessing],
  );

  /** Clicking a queue row only changes the preview, not the run order. */
  const handleSelectQueueFile = React.useCallback((path: string) => {
    setFileInput(path);
    setFileInputSelectionId((v) => v + 1);
  }, []);

  React.useEffect(() => {
    if (!fileInput) return;

    const timelineId = timelineInfo?.timelineId ?? "standalone";
    const loadKey = `${fileInputSelectionId}:${fileInput}:${timelineId}`;
    if (lastSubtitleLoadKeyRef.current === loadKey) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        await loadSubtitles("file", fileInput, timelineId);
        lastSubtitleLoadKeyRef.current = loadKey;
      } catch (error) {
        console.error("Failed to load subtitles for selected file:", error);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    fileInputSelectionId,
    fileInput,
    loadSubtitles,
    timelineInfo?.timelineId,
  ]);

  React.useEffect(() => {
    if (processingSteps.length > 0 && progressContainerRef.current) {
      progressContainerRef.current.scrollTop = 0;
    }
  }, [processingSteps]);

  const willUseForcedAlignment = enableForcedAlignment && !translate;

  React.useEffect(() => {
    const cleanup = setupEventListeners({
      targetLanguage,
      language,
      enableForcedAlignment: willUseForcedAlignment,
      enableDiarize,
      audioInputMode: effectiveMode,
    });

    return cleanup;
  }, [
    setupEventListeners,
    targetLanguage,
    language,
    willUseForcedAlignment,
    enableDiarize,
    effectiveMode,
  ]);

  React.useEffect(() => {
    if (effectiveMode === "timeline" && isExporting) {
      updateProgressStep({
        progress: exportProgress,
        type: "Prepare",
        label: "progressSteps.prepare.export",
      });
    }
  }, [
    isExporting,
    exportProgress,
    effectiveMode,
    updateProgressStep,
  ]);

  const handleExportToFile = async () => {
    try {
      await exportSubtitlesAs("srt", subtitles, speakers);
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleStartNewTranscription = React.useCallback(async () => {
    clearProgressSteps();
    setIsProcessing(false);
    setTranscriptionProgress(0);
    setIsExporting(false);
    setExportProgress(0);
    setLabeledProgress(null);
    cancelRequestedRef.current = false;
    setFileInput(null);
    setQueue([]);
    setBatchSummary(null);
    setBatchProgress(null);
    if (effectiveMode === "timeline") {
      await refreshAudioTracks();
    }
  }, [
    cancelRequestedRef,
    clearProgressSteps,
    refreshAudioTracks,
    effectiveMode,
    setExportProgress,
    setIsExporting,
    setFileInput,
  ]);

  /**
   * One file through the exact same pipeline as the single-file flow:
   * audio source -> transcribe_audio (same options incl. translate /
   * targetLanguage) -> save the JSON transcript doc. Returns the formatted
   * display segments/speakers that were saved. Throws on failure.
   */
  const transcribeWithAudio = async (
    audioInfo: { path: string; offset: number },
    modelPaths: EnsureModelsResponse,
    speakerLimit: number | null,
    filePath: string | null,
  ) => {
    const options: TranscriptionOptions = {
      audioPath: audioInfo.path,
      offset: Math.round(audioInfo.offset * 1000) / 1000,
      model: modelsState[model].value,
      lang: language,
      translate,
      targetLanguage,
      enableDtw: enableDTW,
      enableVad,
      enableForcedAlignment: willUseForcedAlignment,
      enableGpu,
      enableDiarize,
      maxSpeakers: speakerLimit,
      diarizeBackend,
      density: textDensity,
      maxLines: Math.max(1, Math.floor(maxLinesPerSubtitle ?? 1)),
      // Custom density sends only the active unit's limit; the backend
      // prefers words for space-separated scripts.
      customMaxCharsPerLine:
        textDensity === "custom" && customDensityUnit !== "words"
          ? Math.max(1, Math.floor(customMaxCharsPerLine ?? 1))
          : undefined,
      customMaxWordsPerLine:
        textDensity === "custom" && customDensityUnit === "words"
          ? Math.max(1, Math.floor(customMaxWordsPerLine ?? 1))
          : undefined,
      textCase,
      removePunctuation,
      censoredWords: enableCensor ? getActiveCensorWords(useSettingsStore.getState()) : [],
      censorStyle,
      customPrompt: customPrompt.trim() || undefined,
      asrModelPath: modelPaths.asrModelPath,
      vadModelPath: modelPaths.vadModelPath,
      diarizeSegmentPath: modelPaths.diarizeSegmentPath,
      diarizeEmbeddingPath: modelPaths.diarizeEmbeddingPath,
      diarizeSortformerPath: modelPaths.diarizeSortformerPath,
      alignerModelDir: modelPaths.alignerDir,
    };

    const transcript = await invoke("transcribe_audio", { options });

    return processTranscriptionResults(
      transcript as any,
      useSettingsStore.getState(),
      filePath,
      timelineInfo.timelineId,
    );
  };

  /**
   * Batch run: same settings for every file, strictly one at a time (one
   * model/GPU at a time). Models are ensured once up front. After each
   * file the formatted segments are written straight to
   * `<video-name>.srt` next to the source video, no save dialog. A failed
   * file is marked failed and the loop continues; cancellation stops the
   * loop between files and leaves the interrupted file queued.
   */
  const runBatchQueue = async () => {
    const items = queue;
    cancelRequestedRef.current = false;
    setIsProcessing(true);
    setTranscriptionProgress(0);
    setBatchSummary(null);
    clearProgressSteps();

    setupEventListeners({
      targetLanguage,
      language,
      enableForcedAlignment: willUseForcedAlignment,
      enableDiarize,
      audioInputMode: effectiveMode,
    });

    try {
      const speakerLimit =
        typeof maxSpeakers === "number" && !isNaN(maxSpeakers)
          ? Math.floor(maxSpeakers) || null
          : null;

      const ensureModelsRequest: EnsureModelsRequest = {
        model: modelsState[model].value,
        enableVad,
        enableDiarize,
        enableForcedAlignment: willUseForcedAlignment,
        maxSpeakers: speakerLimit,
        diarizeBackend,
      };

      const modelPaths = await invoke<EnsureModelsResponse>("ensure_models", {
        request: ensureModelsRequest,
      });

      let done = 0;
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (cancelRequestedRef.current) break;

        updateQueueItem(item.path, { status: "running", error: undefined });
        setFileInput(item.path);
        setFileInputSelectionId((v) => v + 1);
        clearProgressSteps();
        setBatchProgress(
          t("batchQueue.fileOf", { current: i + 1, total: items.length }),
        );

        try {
          const audioInfo = await getSourceAudio(
            "file",
            item.path,
            activeSelectedTracks,
          );
          if (!audioInfo) {
            throw new Error("Audio source unavailable (cancelled or missing)");
          }
          const result = await transcribeWithAudio(
            audioInfo,
            modelPaths,
            speakerLimit,
            item.path,
          );
          const srtPath = await srtPathForVideo(item.path);
          await exportSubtitlesToPath("srt", srtPath, result.segments, result.speakers);
          completeAllProgressSteps();
          updateQueueItem(item.path, { status: "done", srtPath });
          done += 1;
        } catch (error) {
          const isCancellation =
            (error instanceof Error && /cancell?ed/i.test(error.message)) ||
            (typeof error === "string" && /cancell?ed/i.test(error));
          if (isCancellation || cancelRequestedRef.current) {
            updateQueueItem(item.path, { status: "queued", error: undefined });
            cancelAllProgressSteps();
            break;
          }
          const { message } = describeError(
            error,
            tErr("errorDialog.transcriptionFailed", "Transcription failed"),
          );
          updateQueueItem(item.path, { status: "failed", error: message });
          failed += 1;
          cancelAllProgressSteps();
        }
      }

      const remaining = items.length - done - failed;
      setBatchSummary(
        t("batchQueue.summary", { done, failed, remaining }),
      );

      if (done > 0) {
        await onTranscriptCreated?.();
        onViewSubtitles?.();
        const nextCount = (transcriptionsCompleted ?? 0) + done;
        updateSetting("transcriptionsCompleted", nextCount);
        if (nextCount >= 10 && !subSlateMilestoneShown) {
          setShowSubSlate(true);
        }
      }
    } finally {
      setIsProcessing(false);
      setTranscriptionProgress(0);
      setIsExporting(false);
      setExportProgress(0);
      setLabeledProgress(null);
      setBatchProgress(null);
      await checkDownloadedModels();
    }
  };

  const handleStartTranscription = async () => {
    if (effectiveMode === "timeline" && !timelineInfo.timelineId) {
      console.error("No timeline selected");
      return;
    }

    cancelRequestedRef.current = false;
    if (effectiveMode === "file" && !fileInput) {
      console.error("No file selected");
      return;
    }

    if (translate && language !== "auto" && language === targetLanguage) {
      showError({
        title: tErr("errorDialog.sameLanguageSourceAndTarget.title", "Source and target language are the same"),
        message: tErr("errorDialog.sameLanguageSourceAndTarget.message", "Please choose a different source or target language before translating."),
      });
      return;
    }

    // 2+ files in standalone file mode: sequential batch run.
    if (effectiveMode === "file" && queue.length > 1) {
      await runBatchQueue();
      return;
    }

    setIsProcessing(true);
    setTranscriptionProgress(0);
    clearProgressSteps();

    setupEventListeners({
      targetLanguage,
      language,
      enableForcedAlignment: willUseForcedAlignment,
      enableDiarize,
      audioInputMode: effectiveMode,
    });

    try {
      const speakerLimit =
        typeof maxSpeakers === "number" && !isNaN(maxSpeakers)
          ? Math.floor(maxSpeakers) || null
          : null;

      const ensureModelsRequest: EnsureModelsRequest = {
        model: modelsState[model].value,
        enableVad,
        enableDiarize,
        enableForcedAlignment: willUseForcedAlignment,
        maxSpeakers: speakerLimit,
        diarizeBackend,
      };

      const [audioInfo, modelPaths] = await Promise.all([
        getSourceAudio(
          effectiveMode,
          fileInput,
          activeSelectedTracks,
        ),
        invoke<EnsureModelsResponse>("ensure_models", { request: ensureModelsRequest }),
      ]);

      if (!audioInfo) {
        // `getSourceAudio` returns null only on user-initiated cancellation.
        // Silently clean up without showing an error dialog.
        console.log("Audio source unavailable (cancelled or missing)");
        return;
      }

      await transcribeWithAudio(audioInfo, modelPaths, speakerLimit, fileInput);

      completeAllProgressSteps();

      await onTranscriptCreated?.();
      onViewSubtitles?.();

      const nextCount = (transcriptionsCompleted ?? 0) + 1;
      updateSetting("transcriptionsCompleted", nextCount);
      if (nextCount >= 10 && !subSlateMilestoneShown) {
        setShowSubSlate(true);
      }
    } catch (error) {
      console.error("Transcription failed:", error);

      // User-initiated cancellation is a normal path, not an error.
      const isCancellation =
        (error instanceof Error && /cancell?ed/i.test(error.message)) ||
        (typeof error === "string" && /cancell?ed/i.test(error));
      if (isCancellation) {
        return;
      }

      // End the run explicitly. Nothing else does, and a run that is neither
      // complete nor cancelled leaves the stepper mid-flight and pins the right
      // panel to a draft transcript that will never finish.
      cancelAllProgressSteps();

      // Distinguish export-stage failures (thrown by `getSourceAudio` via
      // `exportAudio`) from transcription-stage failures so the dialog title
      // accurately reflects where things went wrong.
      const isExportFailure =
        error instanceof ResolveApiError &&
        (error.func === "ExportAudio" || error.func === "GetExportProgress");

      const fallbackTitle = isExportFailure
        ? tErr("errorDialog.exportFailed", "Audio export failed")
        : tErr("errorDialog.transcriptionFailed", "Transcription failed");

      const { title, message, detail } = describeError(error, fallbackTitle);
      showError({ title, message, detail });
    } finally {
      setIsProcessing(false);
      setTranscriptionProgress(0);
      setIsExporting(false);
      setExportProgress(0);
      setLabeledProgress(null);
      await checkDownloadedModels();
    }
  };

  const handleCancelTranscription = async () => {
    console.log("Cancelling process...");
    cancelRequestedRef.current = true;

    try {
      if (isProcessing) {
        await invoke("cancel_transcription");
        console.log("Transcription cancellation request sent to backend");
      }

      if (isExporting && !isProcessing) {
        const cancelResult = await cancelExport();
        console.log("Export cancellation result:", cancelResult);
      }

      cancelAllProgressSteps();
      setIsProcessing(false);
      setTranscriptionProgress(0);
      setIsExporting(false);
      setExportProgress(0);
      setLabeledProgress(null);
    } catch (error) {
      console.error("Failed to cancel process:", error);
      setIsProcessing(false);
      setTranscriptionProgress(0);
      setIsExporting(false);
      setExportProgress(0);
      setLabeledProgress(null);
    } finally {
      cancelRequestedRef.current = true;
    }
  };

  return (
    <>
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0">
          <TranscriptionPanelView
            modelsState={modelsState}
            selectedModelIndex={model}
            selectedLanguage={language}
            onSelectModel={(modelIndex) => {
              updateSetting("model", modelIndex);
            }}
            downloadingModel={null}
            downloadProgress={0}
            openModelSelector={openModelSelector}
            onOpenModelSelectorChange={setOpenModelSelector}
            isSmallScreen={isSmallScreen}
            audioInputMode={effectiveMode}
            onAudioInputModeChange={(mode) =>
              updateSetting("audioInputMode", mode)
            }
            processingSteps={processingSteps}
            progressContainerRef={progressContainerRef}
            onExportToFile={handleExportToFile}
            onViewSubtitles={onViewSubtitles}
            isSubtitleViewerOpen={isSubtitleViewerOpen}
            timelineInfo={timelineInfo}
            selectedFile={fileInput}
            onSelectedFileChange={handleSelectedFileChange}
            queue={effectiveMode === "file" ? queue : undefined}
            onAddFiles={handleAddFiles}
            onRemoveQueueFile={handleRemoveQueueFile}
            onSelectQueueFile={handleSelectQueueFile}
            batchSummary={batchSummary}
            batchProgressLabel={batchProgress}
            onStart={handleStartTranscription}
            onCancel={handleCancelTranscription}
            onStartNewTranscription={handleStartNewTranscription}
            onRefreshAudioTracks={refreshAudioTracks}
            isProcessing={isProcessing}
            selectedIntegration={selectedIntegration}
          />
        </div>
      </div>

      <SubSlateCard
        open={showSubSlate}
        onClose={() => {
          setShowSubSlate(false);
          updateSetting("subSlateMilestoneShown", true);
        }}
        milestone="10 transcriptions complete"
      />
    </>
  );
}
