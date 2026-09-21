"use client";

import * as React from "react";
import {
  AtSign,
  ChevronDown,
  ContactRound,
  FileUp,
  ImagePlus,
  MapPin,
  Mic,
  ScanLine,
  SendHorizontal,
  SmilePlus,
  Square,
  Video,
  X,
} from "lucide-react";
import { SessionType, type ConversationItem, type MessageItem } from "@openim/wasm-client-sdk";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { openIMMessageSummary } from "@/components/openim-message-content";
import { openIMSDK } from "@/lib/openim-sdk";
import { cn } from "@/lib/utils";

const EMOJIS = [
  "😀", "😄", "😁", "😂", "😊", "😍", "😘", "😎",
  "🤔", "😢", "😭", "😡", "👍", "👏", "🙏", "🎉",
  "❤️", "💪", "🙆", "👌", "🔥", "✨", "🌹", "☕",
];

export type OpenIMAttachmentKind = "image" | "video" | "audio" | "file";
export type OpenIMLocalAttachment = OpenIMLocalFile & {
  kind: OpenIMAttachmentKind;
  duration?: number;
};

function attachmentKind(file: File): OpenIMAttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"].includes(extension || "")) return "image";
  if (["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(extension || "")) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "amr"].includes(extension || "")) return "audio";
  return "file";
}

async function materializeFile(file: File): Promise<OpenIMLocalAttachment> {
  const fileName = file.name || `openim-${Date.now()}`;
  const materialized = await window.agentDesktop.openIM.materializeFile({
    fileName,
    data: await file.arrayBuffer(),
  });
  return { ...materialized, kind: attachmentKind(file) };
}

export function OpenIMComposer({
  conversation,
  disabled,
  sending,
  replyTo,
  insertion,
  onCancelReply,
  onSend,
  onTyping,
  onPickAttachment,
  onPickCard,
  onPickLocation,
  onPickMention,
  onSendLocalAttachments,
  onError,
}: {
  conversation: ConversationItem;
  disabled: boolean;
  sending: boolean;
  replyTo: MessageItem | null;
  insertion: { key: number; text: string } | null;
  onCancelReply: () => void;
  onSend: (content: string) => Promise<boolean>;
  onTyping: () => void;
  onPickAttachment: (kind: OpenIMAttachmentKind) => void;
  onPickCard: () => void;
  onPickLocation: () => void;
  onPickMention: () => void;
  onSendLocalAttachments: (files: OpenIMLocalAttachment[]) => void;
  onError: (message: string) => void;
}) {
  const [content, setContent] = React.useState(conversation.draftText || "");
  const [height, setHeight] = React.useState(220);
  const [sendOnEnter, setSendOnEnter] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recordingStreamRef = React.useRef<MediaStream | null>(null);
  const recordingChunksRef = React.useRef<Blob[]>([]);
  const recordingStartedAtRef = React.useRef(0);
  const recordingTimerRef = React.useRef<number | null>(null);
  const discardRecordingRef = React.useRef(false);

  React.useEffect(() => {
    setContent(conversation.draftText || "");
  }, [conversation.conversationID, conversation.draftText]);

  React.useEffect(() => {
    if (!insertion) return;
    setContent((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${insertion.text} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [insertion?.key]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void openIMSDK.setConversationDraft({
        conversationID: conversation.conversationID,
        draftText: content,
      }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [content, conversation.conversationID]);

  React.useEffect(() => () => {
    discardRecordingRef.current = true;
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const submit = async () => {
    const clean = content.trim();
    if (!clean || disabled || sending) return;
    if (await onSend(clean)) {
      setContent("");
      void openIMSDK.setConversationDraft({
        conversationID: conversation.conversationID,
        draftText: "",
      }).catch(() => {});
    }
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setContent((current) => current + emoji);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setContent((current) => `${current.slice(0, start)}${emoji}${current.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const sendBrowserFiles = async (files: File[]) => {
    if (!files.length || disabled) return;
    try {
      onSendLocalAttachments(await Promise.all(files.slice(0, 20).map(materializeFile)));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const captureScreen = async () => {
    try {
      const screenshot = await window.agentDesktop.openIM.captureScreen();
      onSendLocalAttachments([{
        ...screenshot,
        kind: "image",
      }]);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const toggleRecording = async () => {
    if (recording) {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Math.max(1, Math.ceil((Date.now() - recordingStartedAtRef.current) / 1000));
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        recordingChunksRef.current = [];
        setRecording(false);
        setRecordingSeconds(0);
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        if (discardRecordingRef.current || !blob.size) return;
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: recorder.mimeType });
        void materializeFile(file)
          .then((attachment) => onSendLocalAttachments([{ ...attachment, kind: "audio", duration }]))
          .catch((error) => onError(error instanceof Error ? error.message : String(error)));
      };
      recorder.start(250);
      discardRecordingRef.current = false;
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 500);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: PointerEvent) => {
      const maximum = Math.max(260, Math.floor(window.innerHeight * 0.6));
      setHeight(Math.min(maximum, Math.max(180, startHeight + startY - moveEvent.clientY)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  return (
    <div className="relative flex shrink-0 flex-col border-t border-border/70 bg-background" style={{ height }}>
      <div className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize" title="拖动调整发送区高度" onPointerDown={startResize} onDoubleClick={() => setHeight(220)}><div className="mx-auto mt-0.5 h-0.5 w-10 rounded-full bg-border opacity-0 transition-opacity hover:opacity-100" /></div>
      {replyTo ? (
        <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-primary pl-2 text-xs">
            <div className="font-medium text-foreground">回复 {replyTo.senderNickname}</div>
            <div className="truncate text-muted-foreground">{openIMMessageSummary(replyTo)}</div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" title="取消回复" onClick={onCancelReply}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex h-10 shrink-0 items-center gap-1 px-3 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" title="表情" disabled={disabled}>
              <SmilePlus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="grid w-64 grid-cols-8 gap-1 p-2">
            {EMOJIS.map((emoji, index) => (
              <button key={`${emoji}-${index}`} type="button" className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted" onClick={() => insertEmoji(emoji)}>
                {emoji}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="ghost" size="icon-sm" title="发送图片" disabled={disabled} onClick={() => onPickAttachment("image")}>
          <ImagePlus className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" title="发送视频" disabled={disabled} onClick={() => onPickAttachment("video")}><Video className="h-4 w-4" /></Button>
        <Button type="button" variant={recording ? "destructive" : "ghost"} size="icon-sm" title={recording ? "结束录音" : "录制语音"} disabled={disabled} onClick={() => void toggleRecording()}>{recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}</Button>
        {recording ? <span className="mr-1 min-w-9 text-center text-[11px] tabular-nums text-destructive">{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}</span> : null}
        <Button type="button" variant="ghost" size="icon-sm" title="发送文件" disabled={disabled} onClick={() => onPickAttachment("file")}><FileUp className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon-sm" title="屏幕截图" disabled={disabled} onClick={() => void captureScreen()}><ScanLine className="h-4 w-4" /></Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button type="button" variant="ghost" size="icon-sm" title="发送个人名片" disabled={disabled} onClick={onPickCard}><ContactRound className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon-sm" title="发送位置" disabled={disabled} onClick={onPickLocation}><MapPin className="h-4 w-4" /></Button>
        {conversation.conversationType !== SessionType.Single ? (
          <Button type="button" variant="ghost" size="icon-sm" title="@群成员" disabled={disabled} onClick={onPickMention}>
            <AtSign className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div
        className={cn("relative min-h-0 flex-1 px-3 pb-3", dragging && "bg-primary/5 ring-1 ring-inset ring-primary/30")}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void sendBrowserFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (sendOnEnter ? !event.shiftKey : event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (!images.length) return;
            event.preventDefault();
            void sendBrowserFiles(images);
          }}
          placeholder={`发送给 ${conversation.showName}`}
          className="h-full min-h-0 resize-none border-0 bg-transparent pb-12 pr-28 text-sm leading-6 shadow-none focus-visible:ring-0"
          disabled={disabled}
        />
        <div className="absolute bottom-4 right-4 flex items-center">
          <Button type="button" className="rounded-r-none" onClick={() => void submit()} disabled={disabled || sending || !content.trim()} title="发送消息"><SendHorizontal className="h-4 w-4" />发送</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="icon" className="w-8 rounded-l-none border-l border-primary-foreground/20" disabled={disabled} title="选择发送方式"><ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setSendOnEnter(true)}>{sendOnEnter ? "✓ " : ""}Enter 发送</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSendOnEnter(false)}>{!sendOnEnter ? "✓ " : ""}Ctrl / Command + Enter 发送</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
