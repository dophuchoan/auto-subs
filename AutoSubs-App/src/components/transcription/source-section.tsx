import * as React from "react";
import {
  AudioLines,
  MonitorIcon,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/animated-tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  UploadIcon,
  type UploadIconHandle,
} from "@/components/ui/icons/upload";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { Integration } from "@/contexts/IntegrationContext";
import type { Track } from "@/types";
import { SUPPORTED_MEDIA_EXTENSIONS, isVideoExtension } from "./utils";
import {
  batchFileName,
  type BatchQueueItem,
} from "./batch-queue";
import { MediaPlayer } from "@/components/media/media-player";
import { FileIcon } from "@untitledui/file-icons";

interface SourceModeTabsProps {
  audioInputMode: "file" | "timeline";
  onAudioInputModeChange: (mode: "file" | "timeline") => void;
  onSwitchToTimeline: () => void;
}

export function SourceModeTabs({
  audioInputMode,
  onAudioInputModeChange,
  onSwitchToTimeline,
}: SourceModeTabsProps) {
  const { t, i18n } = useTranslation();
  const uploadIconRef = React.useRef<UploadIconHandle>(null);

  return (
    <Tabs
      value={audioInputMode}
      onValueChange={(value) => {
        const mode = value as "file" | "timeline";
        onAudioInputModeChange(mode);
        if (mode === "timeline") {
          onSwitchToTimeline();
        }
      }}
      key={i18n.language}
      className="w-full"
    >
      <TabsList className="h-9 w-full p-1">
        <TabsTrigger value="timeline" className="h-7 gap-1.5 px-3 text-sm">
          <MonitorIcon className="size-4" />
          {t("actionBar.mode.timeline")}
        </TabsTrigger>
        <TabsTrigger
          value="file"
          className="h-7 gap-1.5 px-3 text-sm"
          onMouseEnter={() => uploadIconRef.current?.startAnimation()}
          onMouseLeave={() => uploadIconRef.current?.stopAnimation()}
        >
          <UploadIcon ref={uploadIconRef} className="size-4" size={16} />
          {t("actionBar.mode.fileInput")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

interface FileDropAreaProps {
  selectedFile: string | null;
  onSelectedFileChange: (file: string | null) => void;
  className?: string;
  /** Batch queue (standalone file mode). When provided, picking files appends to it. */
  queue?: BatchQueueItem[];
  onAddFiles?: (files: string[]) => void;
  onRemoveFile?: (path: string) => void;
  onSelectFile?: (path: string) => void;
  isProcessing?: boolean;
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function getFileExtension(filePath: string): string {
  const fileName = getFileName(filePath);
  const extension = fileName.split(".").pop();
  return extension && extension !== fileName
    ? extension.toUpperCase()
    : "Media";
}

const localizedDigits: Record<string, string[]> = {
  ja: ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"],
  ko: ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"],
  zh: ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"],
};

export function formatLocalizedTrackNumber(
  value: number,
  language: string,
): string {
  const baseLanguage = language.split("-")[0]?.toLowerCase();
  const digits = baseLanguage ? localizedDigits[baseLanguage] : undefined;

  if (digits) {
    return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
  }

  return new Intl.NumberFormat(language).format(value);
}

export function FileDropArea({
  selectedFile,
  onSelectedFileChange,
  className = "min-h-0 flex-1",
  queue,
  onAddFiles,
  onRemoveFile,
  onSelectFile,
  isProcessing = false,
}: FileDropAreaProps) {
  const { t } = useTranslation();
  const iconRef = React.useRef<UploadIconHandle>(null);

  const isVideo = selectedFile ? isVideoExtension(selectedFile) : false;

  const audioSrc = React.useMemo(
    () => (selectedFile ? convertFileSrc(selectedFile) : null),
    [selectedFile],
  );

  const handleFileSelect = React.useCallback(async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: t("actionBar.fileDialog.mediaFiles"),
          extensions: SUPPORTED_MEDIA_EXTENSIONS,
        },
      ],
      defaultPath: await downloadDir(),
    });
    const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (files.length === 0) return;
    // Batch mode: append to the queue (the panel dedupes by path).
    if (onAddFiles) {
      onAddFiles(files);
      return;
    }
    onSelectedFileChange(files[0]);
  }, [t, onSelectedFileChange, onAddFiles]);

  const statusLabel = (item: BatchQueueItem) => {
    switch (item.status) {
      case "running":
        return t("batchQueue.statusRunning");
      case "done":
        return t("batchQueue.statusDone");
      case "failed":
        return t("batchQueue.statusFailed");
      default:
        return t("batchQueue.statusQueued");
    }
  };

  return (
    <div
      className={cn(
        "group flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 bg-muted/10 px-4 py-4 outline-none",
        selectedFile
          ? "transition-none"
          : "transition-colors hover:border-muted-foreground/40 hover:bg-muted/30",
        className,
      )}
      tabIndex={0}
      role="button"
      aria-label={t("actionBar.fileDrop.aria")}
      onClick={handleFileSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleFileSelect();
      }}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      {selectedFile ? (
        <div className="flex w-full max-w-xl flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center justify-center">
              <FileIcon
                type={getFileExtension(selectedFile).toLowerCase()}
                size={40}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {getFileName(selectedFile)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {selectedFile}
              </span>
            </div>
          </div>

          {audioSrc ? (
            <div
              className="min-w-0"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <MediaPlayer
                src={audioSrc}
                filePath={selectedFile || undefined}
                type={isVideo ? "video" : "audio"}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-black/5 dark:bg-white/5 p-3 text-muted-foreground group-hover:text-foreground transition-colors">
            <UploadIcon ref={iconRef} size={24} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">
              {t("actionBar.fileDrop.prompt")}
            </span>
            <span className="text-xs text-muted-foreground/80">
              {t("actionBar.fileDrop.supports")}
            </span>
          </div>
        </div>
      )}

      {queue && queue.length > 0 ? (
        <div
          className="mt-3 flex w-full max-w-xl flex-col gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("batchQueue.title")} ({queue.length})
            </span>
            <button
              type="button"
              disabled={isProcessing}
              onClick={(event) => {
                event.stopPropagation();
                void handleFileSelect();
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
            >
              {t("batchQueue.addFiles")}
            </button>
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {queue.map((item) => (
              <div
                key={item.path}
                role="button"
                tabIndex={0}
                onClick={() => onSelectFile?.(item.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectFile?.(item.path);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left",
                  item.path === selectedFile
                    ? "border-primary/30 bg-muted/50"
                    : "border-transparent bg-muted/20 hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    item.status === "done" &&
                      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    item.status === "running" &&
                      "bg-primary/15 text-primary",
                    item.status === "failed" &&
                      "bg-destructive/15 text-destructive",
                    item.status === "queued" &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {statusLabel(item)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {batchFileName(item.path)}
                  </span>
                  {item.status === "failed" && item.error ? (
                    <span className="block truncate text-[11px] text-destructive">
                      {item.error}
                    </span>
                  ) : item.status === "done" && item.srtPath ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.srtPath}
                    </span>
                  ) : null}
                </span>
                {!isProcessing && item.status !== "running" ? (
                  <button
                    type="button"
                    aria-label={t("batchQueue.remove")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveFile?.(item.path);
                    }}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface TimelineTrackSelectorProps {
  inputTracks: Track[];
  selectedIntegration: Integration;
  onRefreshTracks?: () => void;
  isRefreshingTracks?: boolean;
  className?: string;
}

export function TimelineTrackSelector({
  inputTracks,
  selectedIntegration,
  onRefreshTracks,
  isRefreshingTracks = false,
  className,
}: TimelineTrackSelectorProps) {
  const { t, i18n } = useTranslation();
  const selectedInputTracksByApp = useSettingsStore((s) => s.selectedInputTracksByApp);
  const exportRange = useSettingsStore((s) => s.exportRange);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [isSpinning, setIsSpinning] = React.useState(false);

  const selectedTracks =
    selectedInputTracksByApp[selectedIntegration] || [];
  const selectedTrackCount = selectedTracks.length;
  const formatTrackNumber = React.useCallback(
    (value: number) => formatLocalizedTrackNumber(value, i18n.language),
    [i18n.language],
  );

  const toggleInputTrack = React.useCallback(
    (trackId: string) => {
      const currentTracks =
        selectedInputTracksByApp[selectedIntegration] || [];
      const isSelected = currentTracks.includes(trackId);
      const nextTracks = isSelected
        ? currentTracks.filter((id: string) => id !== trackId)
        : [...currentTracks, trackId];

      const nextMap = {
        ...selectedInputTracksByApp,
        [selectedIntegration]: nextTracks,
      };

      updateSetting("selectedInputTracksByApp", nextMap);
    },
    [
      selectedInputTracksByApp,
      selectedIntegration,
      updateSetting,
    ],
  );

  const handleRefreshClick = React.useCallback(() => {
    if (onRefreshTracks && !isRefreshingTracks) {
      setIsSpinning(true);
      onRefreshTracks();
      setTimeout(() => setIsSpinning(false), 500);
    }
  }, [onRefreshTracks, isRefreshingTracks]);

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      {inputTracks.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {selectedTrackCount > 0
                  ? t("actionBar.tracks.countSelected", {
                      count: selectedTrackCount,
                    })
                  : t("actionBar.tracks.noneSelected")}
              </span>
              {onRefreshTracks && (
                <button
                  onClick={handleRefreshClick}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("actionBar.tracks.refresh")}
                >
                  <RefreshCw
                    className={cn("size-3.5", isSpinning && "animate-spin")}
                  />
                </button>
              )}
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{t("actionBar.tracks.exportRange.inout")}</span>
              <Switch
                checked={exportRange === "inout"}
                onCheckedChange={(checked) =>
                  updateSetting("exportRange", checked ? "inout" : "entire")
                }
                aria-label={t("actionBar.tracks.exportRange.inout")}
              />
            </label>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="min-h-0 h-full space-y-1.5 overflow-y-auto p-2 pt-0 pr-2.5 pb-3">
              {inputTracks.map((track, index) => {
                const isChecked = selectedTracks.includes(track.value);

                return (
                  <div
                    key={track.value}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all",
                      isChecked
                        ? "bg-card shadow-sm"
                        : "border-transparent bg-transparent hover:bg-muted/50",
                    )}
                    onClick={() => toggleInputTrack(track.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleInputTrack(track.value);
                      }
                    }}
                  >
                    <Checkbox
                      checked={isChecked}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="pointer-events-none border-muted-foreground/35 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                    />
                    <AudioLines
                      className={cn(
                        "size-4 transition-colors",
                        isChecked ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm font-medium transition-colors",
                        isChecked ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {track.label}
                    </span>
                    <span
                      className={cn(
                        "flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs font-semibold transition-colors",
                        isChecked
                          ? "border-primary/15 bg-muted/45 text-foreground"
                          : "border-transparent bg-muted/20 text-muted-foreground/70",
                      )}
                    >
                      {formatTrackNumber(index + 1)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-background to-transparent" />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/10 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("actionBar.tracks.createTrack")}
          </p>
        </div>
      )}
    </div>
  );
}
