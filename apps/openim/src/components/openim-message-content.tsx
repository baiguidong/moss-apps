"use client";

import * as React from "react";
import {
  ContactRound,
  Download,
  FileText,
  MapPin,
  MessageSquareQuote,
  MessagesSquare,
  Phone,
} from "lucide-react";
import { MessageType, type CardElem, type MessageItem } from "@openim/wasm-client-sdk";
import { Button } from "@/components/ui/button";
import { openIMHost } from "@/lib/host";
import { cn } from "@/lib/utils";

export function formatBytes(value = 0) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function parseCustomMessage(message: MessageItem) {
  const custom = message.customElem;
  if (!custom) return "[自定义消息]";
  try {
    const parsed = JSON.parse(custom.data || "{}");
    const callType = parsed?.customType ?? parsed?.type;
    if (callType !== undefined) return "[音视频通话]";
  } catch {
    // Keep the SDK description below when custom data is not JSON.
  }
  return custom.description || custom.data || "[自定义消息]";
}

export function openIMMessageSummary(message?: MessageItem | null) {
  if (!message) return "";
  switch (message.contentType) {
    case MessageType.TextMessage:
      return message.textElem?.content || "";
    case MessageType.AtTextMessage:
      return message.atTextElem?.text || "";
    case MessageType.PictureMessage:
      return "[图片]";
    case MessageType.VoiceMessage:
      return "[语音]";
    case MessageType.VideoMessage:
      return "[视频]";
    case MessageType.FileMessage:
      return message.fileElem?.fileName ? `[文件] ${message.fileElem.fileName}` : "[文件]";
    case MessageType.QuoteMessage:
      return message.quoteElem?.text || "[引用消息]";
    case MessageType.MergeMessage:
      return message.mergeElem?.title || "[聊天记录]";
    case MessageType.CardMessage:
      return message.cardElem?.nickname ? `[名片] ${message.cardElem.nickname}` : "[名片]";
    case MessageType.LocationMessage:
      return message.locationElem?.description || "[位置]";
    case MessageType.FaceMessage:
      return message.faceElem?.data || "[表情]";
    case MessageType.CustomMessage:
      return parseCustomMessage(message);
    case MessageType.RevokeMessage:
      return "[消息已撤回]";
    default:
      return message.notificationElem ? "[系统消息]" : "[不支持的消息]";
  }
}

function LinkifiedText({ value }: { value: string }) {
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => /^https?:\/\//.test(part) ? (
        <button
          key={`${part}-${index}`}
          type="button"
          className="text-inherit underline underline-offset-2"
          onClick={() => void openIMHost.openExternal(part)}
        >
          {part}
        </button>
      ) : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>)}
    </span>
  );
}

function FileMessage({ message, onDownload }: {
  message: MessageItem;
  onDownload: (url: string, fileName: string) => void;
}) {
  const file = message.fileElem!;
  return (
    <div className="flex min-w-56 items-center gap-3 rounded-md border border-border/70 bg-background p-3 text-foreground">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.fileName}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatBytes(file.fileSize)}</div>
      </div>
      {file.sourceUrl ? (
        <Button type="button" variant="ghost" size="icon-sm" title="下载文件" onClick={() => onDownload(file.sourceUrl, file.fileName)}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function CardMessage({ card, onOpenCard }: { card: CardElem; onOpenCard: (card: CardElem) => void }) {
  return (
    <button
      type="button"
      className="flex min-w-52 items-center gap-3 rounded-md border border-border/70 bg-background p-3 text-left text-foreground hover:bg-muted/50"
      onClick={() => onOpenCard(card)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10 text-primary">
        {card.faceURL ? <img src={card.faceURL} alt="" className="h-full w-full object-cover" /> : <ContactRound className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{card.nickname}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">个人名片</div>
      </div>
    </button>
  );
}

export function OpenIMMessageContent({
  message,
  mine,
  onOpenImage,
  onOpenMerge,
  onOpenCard,
  onDownload,
}: {
  message: MessageItem;
  mine: boolean;
  onOpenImage: (url: string) => void;
  onOpenMerge: (message: MessageItem) => void;
  onOpenCard: (card: CardElem) => void;
  onDownload: (url: string, fileName: string) => void;
}) {
  const textClass = cn(
    "inline-block max-w-full rounded-lg px-3 py-2 text-left text-sm leading-6",
    mine ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground",
  );

  switch (message.contentType) {
    case MessageType.TextMessage:
      return <div className={textClass}><LinkifiedText value={message.textElem?.content || ""} /></div>;
    case MessageType.AtTextMessage:
      return <div className={textClass}><LinkifiedText value={message.atTextElem?.text || ""} /></div>;
    case MessageType.FaceMessage:
      return <div className="px-1 py-0.5 text-4xl leading-none">{message.faceElem?.data || "表情"}</div>;
    case MessageType.PictureMessage: {
      const picture = message.pictureElem;
      const preview = picture?.snapshotPicture?.url || picture?.sourcePicture?.url;
      const source = picture?.bigPicture?.url || picture?.sourcePicture?.url || preview;
      return preview ? (
        <button type="button" className="block overflow-hidden rounded-md" onClick={() => onOpenImage(source || preview)}>
          <img src={preview} alt="图片消息" className="max-h-72 max-w-[min(420px,65vw)] object-contain" />
        </button>
      ) : <div className={textClass}>图片上传中</div>;
    }
    case MessageType.VoiceMessage: {
      const sound = message.soundElem;
      return (
        <div className="flex min-w-56 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-foreground">
          <audio controls preload="metadata" src={sound?.sourceUrl} className="h-8 min-w-0 flex-1" />
          <span className="shrink-0 text-[11px] text-muted-foreground">{Math.ceil(sound?.duration || 0)}s</span>
        </div>
      );
    }
    case MessageType.VideoMessage: {
      const video = message.videoElem;
      return (
        <video
          controls
          preload="metadata"
          src={video?.videoUrl}
          poster={video?.snapshotUrl || undefined}
          className="max-h-80 max-w-[min(480px,68vw)] rounded-md bg-black"
        />
      );
    }
    case MessageType.FileMessage:
      return <FileMessage message={message} onDownload={onDownload} />;
    case MessageType.QuoteMessage: {
      const quote = message.quoteElem;
      return (
        <div className={cn(textClass, "min-w-48") }>
          <div className={cn("mb-2 border-l-2 pl-2 text-xs", mine ? "border-primary-foreground/50 text-primary-foreground/75" : "border-border text-muted-foreground")}>
            <div className="font-medium">{quote?.quoteMessage?.senderNickname}</div>
            <div className="line-clamp-2">{openIMMessageSummary(quote?.quoteMessage)}</div>
          </div>
          <LinkifiedText value={quote?.text || ""} />
        </div>
      );
    }
    case MessageType.MergeMessage:
      return (
        <button type="button" className="block min-w-64 rounded-md border border-border bg-background p-3 text-left text-foreground hover:bg-muted/50" onClick={() => onOpenMerge(message)}>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><MessagesSquare className="h-4 w-4" />{message.mergeElem?.title || "聊天记录"}</div>
          <div className="space-y-1 text-xs text-muted-foreground">
            {(message.mergeElem?.abstractList || []).slice(0, 4).map((item, index) => <div key={index} className="truncate">{item}</div>)}
          </div>
          <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">查看合并记录</div>
        </button>
      );
    case MessageType.CardMessage:
      return message.cardElem ? <CardMessage card={message.cardElem} onOpenCard={onOpenCard} /> : <div className={textClass}>名片不可用</div>;
    case MessageType.LocationMessage: {
      const location = message.locationElem;
      const mapUrl = `https://www.openstreetmap.org/?mlat=${location?.latitude}&mlon=${location?.longitude}#map=16/${location?.latitude}/${location?.longitude}`;
      return (
        <button type="button" className="block min-w-64 rounded-md border border-border bg-background p-3 text-left text-foreground hover:bg-muted/50" onClick={() => void openIMHost.openExternal(mapUrl)}>
          <div className="flex items-center gap-2 text-sm font-medium"><MapPin className="h-4 w-4 text-primary" />{location?.description || "位置"}</div>
          <div className="mt-2 text-xs text-muted-foreground">{location?.latitude}, {location?.longitude}</div>
        </button>
      );
    }
    case MessageType.CustomMessage:
      return <div className={cn(textClass, "flex items-center gap-2")}><Phone className="h-4 w-4" />{parseCustomMessage(message)}</div>;
    case MessageType.RevokeMessage:
      return <div className="flex items-center gap-2 text-xs text-muted-foreground"><MessageSquareQuote className="h-4 w-4" />消息已撤回</div>;
    default:
      return <div className="text-xs text-muted-foreground">{openIMMessageSummary(message)}</div>;
  }
}
