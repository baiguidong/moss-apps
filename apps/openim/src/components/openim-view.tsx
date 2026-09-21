"use client";

import * as React from "react";
import {
  Bell,
  BellOff,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ContactRound,
  Copy,
  Download,
  Forward,
  Loader2,
  MessageSquarePlus,
  MessageSquareReply,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import {
  CbEvents,
  GroupMemberFilter,
  GroupMemberRole,
  MessageReceiveOptType,
  MessageStatus,
  MessageType,
  SessionType,
  ViewType,
  type CardElem,
  type ConversationItem,
  type GroupMemberItem,
  type MessageItem,
  type ReceiptInfo,
  type RevokedInfo,
  type SelfUserInfo,
  type WSEvent,
} from "@openim/wasm-client-sdk";
import {
  openIMDefaultConversationId,
  openIMDirectConversationId,
} from "@moss/app-sdk/openim/identifiers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  OpenIMComposer,
  type OpenIMAttachmentKind,
  type OpenIMLocalAttachment,
} from "@/components/openim-composer";
import {
  OpenIMMessageContent,
  openIMMessageSummary,
} from "@/components/openim-message-content";
import {
  OpenIMCallSignal,
  OpenIMRtcCall,
  parseOpenIMCallSignal,
  type OpenIMCallState,
} from "@/components/openim-rtc-call";
import {
  OpenIMAgentActivity,
  OpenIMAgentPolicyDialog,
  OpenIMPendingReviews,
  type OpenIMPolicyTarget,
} from "@/components/openim-agent-policy";
import { cn } from "@/lib/utils";
import {
  ensureOpenIMSession,
  logoutOpenIMSession,
  openIMSDK,
  type OpenIMProfile,
} from "@/lib/openim-sdk";

type ConnectionState = "connecting" | "connected" | "failed";
type PickedOpenIMFile = Awaited<ReturnType<typeof window.agentDesktop.openIM.pickFiles>>[number];
type OpenIMDirectory = Awaited<ReturnType<typeof window.agentDesktop.openIM.listDirectory>>;
type OpenIMDirectoryUser = OpenIMDirectory["users"][number];
type OpenIMDirectoryDepartment = OpenIMDirectory["departments"][number];
type OpenIMSidebarTab = "messages" | "directory";
type OpenIMDirectoryNode = {
  department: OpenIMDirectoryDepartment;
  departments: OpenIMDirectoryNode[];
  users: OpenIMDirectoryUser[];
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { errDlt?: string; errMsg?: string; message?: string };
    return value.errDlt || value.errMsg || value.message || JSON.stringify(error);
  }
  return String(error || "OpenIM 请求失败");
}

function formatTime(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function latestMessage(conversation: ConversationItem) {
  if (!conversation.latestMsg) return null;
  try {
    return JSON.parse(conversation.latestMsg) as MessageItem;
  } catch {
    return null;
  }
}

function sortConversations(items: ConversationItem[]) {
  return [...items].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    return (right.latestMsgSendTime || 0) - (left.latestMsgSendTime || 0);
  });
}

function mergeConversations(current: ConversationItem[], incoming: ConversationItem[]) {
  const byId = new Map(current.map((item) => [item.conversationID, item]));
  incoming.forEach((item) => byId.set(item.conversationID, item));
  return sortConversations(Array.from(byId.values()));
}

function buildDirectoryTree(directory: OpenIMDirectory): {
  departments: OpenIMDirectoryNode[];
  users: OpenIMDirectoryUser[];
} {
  const departmentIDs = new Set(directory.departments.map((department) => department.id));
  const departmentsByParent = new Map<string | null, OpenIMDirectoryDepartment[]>();
  const usersByDepartment = new Map<string | null, OpenIMDirectoryUser[]>();

  directory.departments.forEach((department) => {
    const parentID = department.parentId && departmentIDs.has(department.parentId)
      ? department.parentId
      : null;
    const children = departmentsByParent.get(parentID) || [];
    children.push(department);
    departmentsByParent.set(parentID, children);
  });
  directory.users.forEach((user) => {
    const departmentID = user.departmentId && departmentIDs.has(user.departmentId)
      ? user.departmentId
      : null;
    const users = usersByDepartment.get(departmentID) || [];
    users.push(user);
    usersByDepartment.set(departmentID, users);
  });

  const visit = (parentID: string | null): OpenIMDirectoryNode[] => (
    (departmentsByParent.get(parentID) || []).map((department) => ({
      department,
      departments: visit(department.id),
      users: usersByDepartment.get(department.id) || [],
    }))
  );

  return {
    departments: visit(null),
    users: usersByDepartment.get(null) || [],
  };
}

function filterDirectoryNode(
  node: OpenIMDirectoryNode,
  query: string,
  ancestorMatched = false,
): OpenIMDirectoryNode | null {
  if (!query) return node;
  const departmentMatched = ancestorMatched || node.department.name.toLowerCase().includes(query);
  const departments = node.departments
    .map((department) => filterDirectoryNode(department, query, departmentMatched))
    .filter((department): department is OpenIMDirectoryNode => Boolean(department));
  const users = departmentMatched
    ? node.users
    : node.users.filter((user) => (
      user.name.toLowerCase().includes(query) || (user.email || "").toLowerCase().includes(query)
    ));
  if (!departmentMatched && !departments.length && !users.length) return null;
  return { ...node, departments, users };
}

function appendMessages(current: MessageItem[], incoming: MessageItem[]) {
  const byId = new Map(current.map((item) => [item.clientMsgID, item]));
  incoming.forEach((item) => byId.set(item.clientMsgID, item));
  return Array.from(byId.values()).sort((left, right) => left.sendTime - right.sendTime);
}

function conversationMatchesMessage(conversation: ConversationItem, message: MessageItem, selfUserID: string) {
  if (conversation.conversationType === SessionType.Single) {
    const peerID = message.sendID === selfUserID ? message.recvID : message.sendID;
    return conversation.userID === peerID;
  }
  return Boolean(message.groupID) && conversation.groupID === message.groupID;
}

function normalizeEventItems<T>(event: WSEvent<T | T[]>) {
  if (Array.isArray(event.data)) return event.data;
  return event.data ? [event.data] : [];
}

function mediaDuration(url: string, kind: "audio" | "video") {
  return new Promise<number>((resolve) => {
    const media = document.createElement(kind);
    const done = (value: number) => {
      media.removeAttribute("src");
      media.load();
      resolve(Number.isFinite(value) ? value : 0);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => done(media.duration);
    media.onerror = () => done(0);
    media.src = url;
  });
}

function Avatar({ name, url, group = false, size = "md" }: {
  name: string;
  url?: string;
  group?: boolean;
  size?: "sm" | "md" | "message";
}) {
  return (
    <div className={cn(
      "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10 text-primary",
      size === "sm" ? "h-8 w-8" : size === "message" ? "h-9 w-9" : "h-10 w-10",
    )}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : group ? (
        <UsersRound className="h-5 w-5" />
      ) : name ? (
        <span className="text-sm font-semibold">{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <UserRound className="h-5 w-5" />
      )}
    </div>
  );
}

function ModalShell({ title, children, onClose, width = "max-w-md" }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={cn("flex max-h-[80vh] w-full flex-col rounded-lg border border-border bg-background shadow-2xl", width)} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="text-sm font-semibold">{title}</div>
          <Button type="button" variant="ghost" size="icon-sm" title="关闭" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function OpenIMView() {
  const [profile, setProfile] = React.useState<OpenIMProfile | null>(null);
  const [selfInfo, setSelfInfo] = React.useState<SelfUserInfo | null>(null);
  const [connection, setConnection] = React.useState<ConnectionState>("connecting");
  const [initializing, setInitializing] = React.useState(true);
  const [connectionError, setConnectionError] = React.useState("");
  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [activeConversation, setActiveConversation] = React.useState<ConversationItem | null>(null);
  const [messages, setMessages] = React.useState<MessageItem[]>([]);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = React.useState(false);
  const [hasMoreHistory, setHasMoreHistory] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [messageSearchOpen, setMessageSearchOpen] = React.useState(false);
  const [messageQuery, setMessageQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<MessageItem[] | null>(null);
  const [sending, setSending] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<Record<string, number>>({});
  const [busyLabel, setBusyLabel] = React.useState("");
  const [sidebarTab, setSidebarTab] = React.useState<OpenIMSidebarTab>("messages");
  const [directory, setDirectory] = React.useState<OpenIMDirectory>({ departments: [], users: [] });
  const [collapsedDepartmentIDs, setCollapsedDepartmentIDs] = React.useState<Set<string>>(new Set());
  const [creatingConversationUserID, setCreatingConversationUserID] = React.useState("");
  const [groupCreateOpen, setGroupCreateOpen] = React.useState(false);
  const [groupName, setGroupName] = React.useState("");
  const [selectedGroupUserIDs, setSelectedGroupUserIDs] = React.useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<MessageItem | null>(null);
  const [groupMembers, setGroupMembers] = React.useState<GroupMemberItem[]>([]);
  const [groupManageOpen, setGroupManageOpen] = React.useState(false);
  const [groupNameDraft, setGroupNameDraft] = React.useState("");
  const [selectedInviteUserIDs, setSelectedInviteUserIDs] = React.useState<Set<string>>(new Set());
  const [groupManaging, setGroupManaging] = React.useState(false);
  const [cardPickerOpen, setCardPickerOpen] = React.useState(false);
  const [mentionPickerOpen, setMentionPickerOpen] = React.useState(false);
  const [mentionIDs, setMentionIDs] = React.useState<string[]>([]);
  const [composerInsertion, setComposerInsertion] = React.useState<{ key: number; text: string } | null>(null);
  const [locationOpen, setLocationOpen] = React.useState(false);
  const [locationDescription, setLocationDescription] = React.useState("");
  const [locationLatitude, setLocationLatitude] = React.useState("");
  const [locationLongitude, setLocationLongitude] = React.useState("");
  const [imagePreview, setImagePreview] = React.useState("");
  const [mergePreview, setMergePreview] = React.useState<MessageItem | null>(null);
  const [cardPreview, setCardPreview] = React.useState<CardElem | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; message: MessageItem } | null>(null);
  const [multiSelect, setMultiSelect] = React.useState(false);
  const [selectedMessageIDs, setSelectedMessageIDs] = React.useState<Set<string>>(new Set());
  const [forwardMessages, setForwardMessages] = React.useState<MessageItem[] | null>(null);
  const [forwardMode, setForwardMode] = React.useState<"forward" | "merge">("forward");
  const [typingLabel, setTypingLabel] = React.useState("");
  const [rtcCall, setRtcCall] = React.useState<OpenIMCallState | null>(null);
  const [appInstance, setAppInstance] = React.useState<{ id: string; enabled: boolean } | null>(null);
  const [agentBackendBusy, setAgentBackendBusy] = React.useState(false);
  const [policyTarget, setPolicyTarget] = React.useState<OpenIMPolicyTarget | null>(null);
  const activeConversationRef = React.useRef<ConversationItem | null>(null);
  const selfUserIDRef = React.useRef("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const messageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const loadingOlderRef = React.useRef(false);
  const historyRequestRef = React.useRef(0);
  const typingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastManualTakeoverRef = React.useRef(new Map<string, number>());
  const accountUserIDRef = React.useRef("");
  const accountGenerationRef = React.useRef(0);
  const bootstrapRequestRef = React.useRef(0);

  activeConversationRef.current = activeConversation;
  selfUserIDRef.current = profile?.userID || selfInfo?.userID || "";

  const refreshAppInstance = React.useCallback(async () => {
    const instances = await window.mossApp.instances.list();
    const instance = instances[0];
    setAppInstance(instance ? { id: instance.id, enabled: instance.enabled === true } : null);
    return instance;
  }, []);

  React.useEffect(() => {
    void refreshAppInstance().catch(() => {});
    const unsubscribe = window.mossApp.events.on("runtime", () => {
      void refreshAppInstance().catch(() => {});
    });
    return () => unsubscribe?.();
  }, [refreshAppInstance]);

  const enableAgentBackend = React.useCallback(async () => {
    if (!appInstance || appInstance.enabled || agentBackendBusy) return;
    setAgentBackendBusy(true);
    setConnectionError("");
    try {
      await window.mossApp.instances.setEnabled(appInstance.id, true);
      await refreshAppInstance();
    } catch (error) {
      setConnectionError(`AI 回复服务启用失败：${errorMessage(error)}`);
    } finally {
      setAgentBackendBusy(false);
    }
  }, [agentBackendBusy, appInstance, refreshAppInstance]);

  const openDefaultPolicy = React.useCallback(() => {
    if (!profile?.userID) {
      setConnectionError("连接 OpenIM 后才能配置当前账号的默认 AI 策略。");
      return;
    }
    setPolicyTarget({
      conversationId: openIMDefaultConversationId(profile.userID),
      title: "默认策略",
      kind: "default",
    });
  }, [profile?.userID]);

  const refreshConversations = React.useCallback(async () => {
    const generation = accountGenerationRef.current;
    const result = await openIMSDK.getAllConversationList();
    if (generation !== accountGenerationRef.current) return [];
    const next = sortConversations(result.data || []);
    setConversations(next);
    setActiveConversation((current) => {
      if (!current) return next[0] || null;
      return next.find((item) => item.conversationID === current.conversationID) || next[0] || null;
    });
    return next;
  }, []);

  const refreshDirectory = React.useCallback(async () => {
    const generation = accountGenerationRef.current;
    const result = await window.agentDesktop.openIM.listDirectory();
    if (generation !== accountGenerationRef.current) return { departments: [], users: [] };
    setDirectory(result);
    return result;
  }, []);

  const bootstrap = React.useCallback(async () => {
    const requestId = ++bootstrapRequestRef.current;
    setInitializing(true);
    setConnection("connecting");
    setConnectionError("");
    try {
      const session = await window.agentDesktop.openIM.createSession();
      if (requestId !== bootstrapRequestRef.current) return;
      const nextUserID = String(session.userID || "");
      if (accountUserIDRef.current && accountUserIDRef.current !== nextUserID) {
        accountGenerationRef.current += 1;
        historyRequestRef.current += 1;
        setSelfInfo(null);
        setConversations([]);
        setActiveConversation(null);
        setMessages([]);
        setHasMoreHistory(false);
        setDirectory({ departments: [], users: [] });
        setPolicyTarget(null);
        setReplyTo(null);
        setGroupMembers([]);
        setRtcCall(null);
        lastManualTakeoverRef.current.clear();
      }
      accountUserIDRef.current = nextUserID;
      setProfile(session);
    } catch (error) {
      if (requestId !== bootstrapRequestRef.current) return;
      await logoutOpenIMSession().catch(() => {});
      setProfile(null);
      setConnection("failed");
      setConnectionError(errorMessage(error));
      setInitializing(false);
    }
  }, []);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  React.useEffect(() => {
    if (!profile?.expiresIn) return;
    const refreshLeadSeconds = Math.min(60, Math.max(10, profile.expiresIn * 0.1));
    const refreshDelay = Math.min(
      12 * 60 * 60 * 1000,
      Math.max(10_000, (profile.expiresIn - refreshLeadSeconds) * 1000),
    );
    const timer = window.setTimeout(() => void bootstrap(), refreshDelay);
    return () => window.clearTimeout(timer);
  }, [bootstrap, profile?.expiresIn, profile?.imToken]);

  React.useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    const handleConnecting = () => setConnection("connecting");
    const handleConnected = () => {
      setConnection("connected");
      setConnectionError("");
    };
    const handleConnectFailed = (event: WSEvent) => {
      setConnection("failed");
      setConnectionError(event.errMsg || "OpenIM 连接失败");
    };
    const handleSessionExpired = () => {
      setProfile(null);
      setSelfInfo(null);
      setConversations([]);
      setActiveConversation(null);
      setMessages([]);
      setPolicyTarget(null);
      lastManualTakeoverRef.current.clear();
      setConnectionError("即时消息登录已失效，正在重新连接");
      void logoutOpenIMSession().catch(() => {}).finally(() => bootstrap());
    };
    const handleConversationChanged = (event: WSEvent<ConversationItem[]>) => {
      const incoming = Array.isArray(event.data) ? event.data : [];
      setConversations((current) => mergeConversations(current, incoming));
      setActiveConversation((current) => current
        ? incoming.find((item) => item.conversationID === current.conversationID) || current
        : current);
    };
    const handleNewMessages = (event: WSEvent<MessageItem | MessageItem[]>) => {
      const incoming = normalizeEventItems(event);
      incoming.forEach((message) => {
        const callSignal = parseOpenIMCallSignal(message);
        if (callSignal?.signal !== OpenIMCallSignal.Invite) return;
        if (!callSignal.invitation.inviteeUserIDList.includes(selfUserIDRef.current)) return;
        setRtcCall((current) => current || {
          invitation: callSignal.invitation,
          incoming: true,
          peer: {
            userID: message.sendID,
            nickname: message.senderNickname || message.sendID,
            faceURL: message.senderFaceUrl || "",
          },
        });
      });
      const currentConversation = activeConversationRef.current;
      if (currentConversation) {
        const relevant = incoming.filter((message) => (
          conversationMatchesMessage(currentConversation, message, selfUserIDRef.current)
        ));
        if (relevant.length) {
          setMessages((current) => appendMessages(current, relevant));
          void openIMSDK.markConversationMessageAsRead(currentConversation.conversationID).catch(() => {});
        }
      }
      void refreshConversations().catch(() => {});
    };
    const handleRevoked = (event: WSEvent<RevokedInfo>) => {
      const revokedID = event.data?.clientMsgID;
      if (!revokedID) return;
      setMessages((current) => current.map((message) => message.clientMsgID === revokedID
        ? { ...message, contentType: MessageType.RevokeMessage }
        : message));
    };
    const handleReadReceipt = (event: WSEvent<ReceiptInfo | ReceiptInfo[]>) => {
      const readIDs = new Set(normalizeEventItems(event).flatMap((item) => item.msgIDList || []));
      if (!readIDs.size) return;
      setMessages((current) => current.map((message) => readIDs.has(message.clientMsgID)
        ? { ...message, isRead: true }
        : message));
    };
    const handleOnlineMessage = (event: WSEvent<MessageItem>) => {
      const message = event.data;
      const currentConversation = activeConversationRef.current;
      if (!message || !currentConversation || message.contentType !== MessageType.TypingMessage) return;
      if (!conversationMatchesMessage(currentConversation, message, selfUserIDRef.current)) return;
      setTypingLabel("对方正在输入...");
      if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current);
      remoteTypingTimerRef.current = setTimeout(() => setTypingLabel(""), 1200);
    };
    const handleUploadProgress = (event: WSEvent<{ progress: number; clientMsgID: string }>) => {
      const clientMsgID = event.data?.clientMsgID;
      if (!clientMsgID) return;
      setUploadProgress((current) => ({
        ...current,
        [clientMsgID]: Math.max(0, Math.min(100, Number(event.data.progress) || 0)),
      }));
    };
    const handleGroupChanged = (event: WSEvent<GroupMemberItem>) => {
      const currentConversation = activeConversationRef.current;
      if (!currentConversation?.groupID || event.data?.groupID !== currentConversation.groupID) return;
      void openIMSDK.getGroupMemberList({
        groupID: currentConversation.groupID,
        filter: GroupMemberFilter.All,
        offset: 0,
        count: 1000,
      }).then((result) => setGroupMembers(result.data || [])).catch(() => {});
    };
    const handleSyncFinished = () => {
      void refreshConversations().catch(() => {});
      const currentConversation = activeConversationRef.current;
      if (!currentConversation) return;
      const requestId = ++historyRequestRef.current;
      const conversationID = currentConversation.conversationID;
      void openIMSDK.getAdvancedHistoryMessageList({
        count: 100,
        startClientMsgID: "",
        conversationID,
        viewType: ViewType.History,
      }).then((result) => {
        if (historyRequestRef.current !== requestId || activeConversationRef.current?.conversationID !== conversationID) return;
        setMessages((current) => appendMessages(current, result.data.messageList || []));
        setHasMoreHistory(!result.data.isEnd);
      }).catch(() => {});
    };

    void openIMSDK.on(CbEvents.OnConnecting, handleConnecting);
    void openIMSDK.on(CbEvents.OnConnectSuccess, handleConnected);
    void openIMSDK.on(CbEvents.OnConnectFailed, handleConnectFailed);
    void openIMSDK.on(CbEvents.OnKickedOffline, handleSessionExpired);
    void openIMSDK.on(CbEvents.OnUserTokenExpired, handleSessionExpired);
    void openIMSDK.on(CbEvents.OnUserTokenInvalid, handleSessionExpired);
    void openIMSDK.on(CbEvents.OnConversationChanged, handleConversationChanged);
    void openIMSDK.on(CbEvents.OnNewConversation, handleConversationChanged);
    void openIMSDK.on(CbEvents.OnRecvNewMessage, handleNewMessages);
    void openIMSDK.on(CbEvents.OnRecvNewMessages, handleNewMessages);
    void openIMSDK.on(CbEvents.OnRecvMessageRevoked, handleRevoked);
    void openIMSDK.on(CbEvents.OnNewRecvMessageRevoked, handleRevoked);
    void openIMSDK.on(CbEvents.OnRecvC2CReadReceipt, handleReadReceipt);
    void openIMSDK.on(CbEvents.OnRecvOnlineOnlyMessage, handleOnlineMessage);
    void openIMSDK.on(CbEvents.OnProgress, handleUploadProgress);
    void openIMSDK.on(CbEvents.OnGroupMemberAdded, handleGroupChanged);
    void openIMSDK.on(CbEvents.OnGroupMemberDeleted, handleGroupChanged);
    void openIMSDK.on(CbEvents.OnGroupMemberInfoChanged, handleGroupChanged);
    void openIMSDK.on(CbEvents.OnSyncServerFinish, handleSyncFinished);

    void (async () => {
      setInitializing(true);
      setConnection("connecting");
      setConnectionError("");
      try {
        const localConfig = await window.agentDesktop.openIM.getConfig();
        const config = { ...localConfig, apiAddr: profile.apiAddr, wsAddr: profile.wsAddr };
        if (!config.available) throw new Error(config.error || "OpenIM SDK 不可用");
        const info = await ensureOpenIMSession(profile, config);
        if (cancelled) return;
        setSelfInfo(info);
        setConnection("connected");
        await Promise.all([refreshConversations(), refreshDirectory()]);
      } catch (error) {
        if (!cancelled) {
          setConnection("failed");
          setConnectionError(errorMessage(error));
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
      void openIMSDK.off(CbEvents.OnConnecting, handleConnecting);
      void openIMSDK.off(CbEvents.OnConnectSuccess, handleConnected);
      void openIMSDK.off(CbEvents.OnConnectFailed, handleConnectFailed);
      void openIMSDK.off(CbEvents.OnKickedOffline, handleSessionExpired);
      void openIMSDK.off(CbEvents.OnUserTokenExpired, handleSessionExpired);
      void openIMSDK.off(CbEvents.OnUserTokenInvalid, handleSessionExpired);
      void openIMSDK.off(CbEvents.OnConversationChanged, handleConversationChanged);
      void openIMSDK.off(CbEvents.OnNewConversation, handleConversationChanged);
      void openIMSDK.off(CbEvents.OnRecvNewMessage, handleNewMessages);
      void openIMSDK.off(CbEvents.OnRecvNewMessages, handleNewMessages);
      void openIMSDK.off(CbEvents.OnRecvMessageRevoked, handleRevoked);
      void openIMSDK.off(CbEvents.OnNewRecvMessageRevoked, handleRevoked);
      void openIMSDK.off(CbEvents.OnRecvC2CReadReceipt, handleReadReceipt);
      void openIMSDK.off(CbEvents.OnRecvOnlineOnlyMessage, handleOnlineMessage);
      void openIMSDK.off(CbEvents.OnProgress, handleUploadProgress);
      void openIMSDK.off(CbEvents.OnGroupMemberAdded, handleGroupChanged);
      void openIMSDK.off(CbEvents.OnGroupMemberDeleted, handleGroupChanged);
      void openIMSDK.off(CbEvents.OnGroupMemberInfoChanged, handleGroupChanged);
      void openIMSDK.off(CbEvents.OnSyncServerFinish, handleSyncFinished);
    };
  }, [bootstrap, profile, refreshConversations, refreshDirectory]);

  React.useEffect(() => {
    if (!activeConversation || connection !== "connected") {
      setMessages([]);
      setHasMoreHistory(false);
      return;
    }
    const requestId = ++historyRequestRef.current;
    setMessagesLoading(true);
    setHasMoreHistory(false);
    setReplyTo(null);
    setMultiSelect(false);
    setSelectedMessageIDs(new Set());
    setMessageQuery("");
    setSearchResults(null);
    void openIMSDK.getAdvancedHistoryMessageList({
      count: 100,
      startClientMsgID: "",
      conversationID: activeConversation.conversationID,
      viewType: ViewType.History,
    }).then((result) => {
      if (historyRequestRef.current !== requestId) return;
      setMessages(appendMessages([], result.data.messageList || []));
      setHasMoreHistory(!result.data.isEnd);
      void openIMSDK.markConversationMessageAsRead(activeConversation.conversationID).catch(() => {});
      setConversations((current) => current.map((item) => item.conversationID === activeConversation.conversationID
        ? { ...item, unreadCount: 0 }
        : item));
    }).catch((error) => {
      if (historyRequestRef.current === requestId) setConnectionError(errorMessage(error));
    }).finally(() => {
      if (historyRequestRef.current === requestId) setMessagesLoading(false);
    });

    if (activeConversation.conversationType !== SessionType.Single) {
      void openIMSDK.getGroupMemberList({
        groupID: activeConversation.groupID,
        filter: GroupMemberFilter.All,
        offset: 0,
        count: 1000,
      }).then((result) => setGroupMembers(result.data || [])).catch(() => setGroupMembers([]));
    } else {
      setGroupMembers([]);
    }
  }, [activeConversation?.conversationID, connection]);

  const loadOlderMessages = React.useCallback(async () => {
    if (!activeConversation || !hasMoreHistory || olderMessagesLoading || loadingOlderRef.current || !messages.length) return;
    const scroller = messageScrollRef.current;
    const previousHeight = scroller?.scrollHeight || 0;
    loadingOlderRef.current = true;
    setOlderMessagesLoading(true);
    try {
      const result = await openIMSDK.getAdvancedHistoryMessageList({
        count: 50,
        startClientMsgID: messages[0].clientMsgID,
        conversationID: activeConversation.conversationID,
        viewType: ViewType.History,
      });
      setMessages((current) => appendMessages(current, result.data.messageList || []));
      setHasMoreHistory(!result.data.isEnd);
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop += scroller.scrollHeight - previousHeight;
        loadingOlderRef.current = false;
      });
    } catch (error) {
      loadingOlderRef.current = false;
      setConnectionError(errorMessage(error));
    } finally {
      setOlderMessagesLoading(false);
    }
  }, [activeConversation, hasMoreHistory, messages, olderMessagesLoading]);

  React.useEffect(() => {
    if (!messageSearchOpen || !messageQuery.trim() || !activeConversation) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      void openIMSDK.searchLocalMessages({
        conversationID: activeConversation.conversationID,
        keywordList: [messageQuery.trim()],
        keywordListMatchType: 0,
        pageIndex: 1,
        count: 100,
      }).then((result) => {
        const items = result.data.searchResultItems || result.data.findResultItems || [];
        setSearchResults(items.flatMap((item) => item.messageList || []).sort((a, b) => a.sendTime - b.sendTime));
      }).catch((error) => setConnectionError(errorMessage(error)));
    }, 250);
    return () => clearTimeout(timer);
  }, [messageSearchOpen, messageQuery, activeConversation?.conversationID]);

  React.useEffect(() => {
    if (loadingOlderRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, searchResults]);

  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const cancelPendingAgentReplies = React.useCallback(async (target: ConversationItem) => {
    if (!appInstance?.enabled || !profile?.userID || target.conversationType !== SessionType.Single) return;
    const externalConversationId = openIMDirectConversationId(profile.userID, target.userID);
    const result = await window.mossApp.host.request<{
      turns?: Array<{ id?: string; status?: string; deliveredAt?: number | null }>;
    }>(
      appInstance.id,
      "moss.agent/v1",
      "turn.list",
      { externalConversationId, statuses: ["queued", "running", "awaiting_review", "completed"], limit: 100 },
    );
    await Promise.allSettled((result.turns || []).map((turn) => {
      if (!turn.id || (turn.status === "completed" && turn.deliveredAt)) return Promise.resolve();
      return window.mossApp.host.request(
        appInstance.id,
        "moss.agent/v1",
        turn.status === "awaiting_review" ? "turn.review" : "turn.abort",
        turn.status === "awaiting_review"
          ? { turnId: turn.id, action: "reject" }
          : { turnId: turn.id },
      );
    }));
    window.dispatchEvent(new Event("openim:agent-turns-changed"));
  }, [appInstance, profile?.userID]);

  const beginManualTakeover = React.useCallback((target: ConversationItem | null) => {
    if (!target || target.conversationType !== SessionType.Single) return;
    const now = Date.now();
    const previous = lastManualTakeoverRef.current.get(target.conversationID) || 0;
    if (now - previous < 2_000) return;
    lastManualTakeoverRef.current.set(target.conversationID, now);
    void cancelPendingAgentReplies(target).catch(() => {});
  }, [cancelPendingAgentReplies]);

  const sendCreatedMessage = async (message: MessageItem, target = activeConversation) => {
    if (!target) throw new Error("请选择会话");
    const visible = target.conversationID === activeConversationRef.current?.conversationID;
    await cancelPendingAgentReplies(target).catch(() => {});
    if (visible) setMessages((current) => appendMessages(current, [{ ...message, status: MessageStatus.Sending }]));
    try {
      const sent = await openIMSDK.sendMessage({
        recvID: target.conversationType === SessionType.Single ? target.userID : "",
        groupID: target.conversationType === SessionType.Single ? "" : target.groupID,
        message,
      });
      if (visible) setMessages((current) => appendMessages(current, [sent.data]));
      if (target.conversationType === SessionType.Single && appInstance?.enabled && profile?.userID) {
        const observedText = openIMMessageSummary(sent.data).trim();
        const externalMessageId = String(sent.data.serverMsgID || sent.data.clientMsgID || "");
        if (observedText && externalMessageId) {
          await window.mossApp.host.request(
            appInstance.id,
            "moss.agent/v1",
            "context.observe",
            {
              externalUserId: target.userID,
              externalConversationId: openIMDirectConversationId(profile.userID, target.userID),
              externalEventId: `outgoing:${externalMessageId}`,
              text: observedText,
            },
          ).catch(() => {});
        }
      }
      await refreshConversations();
      return sent.data;
    } catch (error) {
      if (visible) {
        setMessages((current) => current.map((item) => item.clientMsgID === message.clientMsgID
          ? { ...item, status: MessageStatus.Failed }
          : item));
      }
      throw error;
    } finally {
      window.setTimeout(() => setUploadProgress((current) => {
        if (!(message.clientMsgID in current)) return current;
        const next = { ...current };
        delete next[message.clientMsgID];
        return next;
      }), 600);
    }
  };

  const sendText = async (content: string) => {
    if (!activeConversation || sending) return false;
    setSending(true);
    setConnectionError("");
    try {
      const created = replyTo
        ? await openIMSDK.createQuoteMessage({ text: content, message: JSON.stringify(replyTo) })
        : mentionIDs.length
          ? await openIMSDK.createTextAtMessage({ text: content, atUserIDList: mentionIDs })
          : await openIMSDK.createTextMessage(content);
      await sendCreatedMessage(created.data);
      setReplyTo(null);
      setMentionIDs([]);
      return true;
    } catch (error) {
      setConnectionError(errorMessage(error));
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendAttachmentFiles = async (attachments: Array<{
    kind: OpenIMAttachmentKind;
    file: PickedOpenIMFile;
    duration?: number;
  }>) => {
    if (!activeConversation || sending || !attachments.length) return;
    setSending(true);
    setBusyLabel(attachments.length > 1 ? `发送 ${attachments.length} 个附件` : "发送附件");
    setConnectionError("");
    try {
      for (const attachment of attachments) {
        const { file, kind } = attachment;
        let created;
        if (kind === "image") {
          created = await openIMSDK.createImageMessageFromFullPath(file.path);
        } else if (kind === "video") {
          const [duration, thumbnail] = await Promise.all([
            mediaDuration(file.mediaUrl, "video"),
            window.agentDesktop.openIM.createVideoThumbnail({ path: file.path }),
          ]);
          const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
          created = await openIMSDK.createVideoMessageFromFullPath({
            videoPath: file.path,
            videoType: extension === "mov" ? "video/quicktime" : `video/${extension}`,
            duration: Math.ceil(duration),
            snapshotPath: thumbnail.path,
          });
        } else if (kind === "audio") {
          const duration = attachment.duration ?? await mediaDuration(file.mediaUrl, "audio");
          created = await openIMSDK.createSoundMessageFromFullPath({ soundPath: file.path, duration: Math.ceil(duration) });
        } else {
          created = await openIMSDK.createFileMessageFromFullPath({ filePath: file.path, fileName: file.name });
        }
        await sendCreatedMessage(created.data);
      }
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
      setBusyLabel("");
    }
  };

  const pickAttachments = async (kind: OpenIMAttachmentKind) => {
    if (!activeConversation || sending) return;
    const files = await window.agentDesktop.openIM.pickFiles({ kind });
    await sendAttachmentFiles(files.map((file) => ({ kind, file })));
  };

  const sendLocalAttachments = async (items: OpenIMLocalAttachment[]) => {
    if (!items.length) return;
    try {
      await sendAttachmentFiles(items.map((file) => ({
        file,
        kind: file.kind,
        duration: file.duration,
      })));
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const sendCard = async (friend: OpenIMDirectoryUser) => {
    setCardPickerOpen(false);
    setSending(true);
    try {
      const prepared = await window.agentDesktop.openIM.prepareDirectConversation({ userID: friend.id });
      const created = await openIMSDK.createCardMessage({
        userID: prepared.userID,
        nickname: friend.name,
        faceURL: "",
        ex: JSON.stringify({ mossUserId: friend.id }),
      });
      await sendCreatedMessage(created.data);
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const sendLocation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = Number(locationLatitude);
    const longitude = Number(locationLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setSending(true);
    try {
      const created = await openIMSDK.createLocationMessage({
        description: locationDescription.trim() || "位置",
        latitude,
        longitude,
      });
      await sendCreatedMessage(created.data);
      setLocationOpen(false);
      setLocationDescription("");
      setLocationLatitude("");
      setLocationLongitude("");
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const notifyTyping = () => {
    if (!activeConversation || activeConversation.conversationType !== SessionType.Single) return;
    beginManualTakeover(activeConversation);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      void openIMSDK.typingStatusUpdate({ recvID: activeConversation.userID, msgTip: "yes" }).catch(() => {});
    }, 350);
  };

  const startCall = async (mediaType: "audio" | "video") => {
    if (!activeConversation || activeConversation.conversationType !== SessionType.Single || !selfInfo) return;
    const config = await window.agentDesktop.openIM.getConfig();
    setRtcCall({
      invitation: {
        inviterUserID: selfInfo.userID,
        inviteeUserIDList: [activeConversation.userID],
        groupID: "",
        roomID: crypto.randomUUID(),
        timeout: 60,
        mediaType,
        sessionType: SessionType.Single,
        platformID: config.platformID,
      },
      incoming: false,
      peer: {
        userID: activeConversation.userID,
        nickname: activeConversation.showName,
        faceURL: activeConversation.faceURL,
      },
    });
  };

  const closeRtcCall = React.useCallback(() => setRtcCall(null), []);

  const openDirectoryConversation = async (user: OpenIMDirectoryUser) => {
    if (user.id === profile?.user.id || creatingConversationUserID) return;
    setCreatingConversationUserID(user.id);
    setConnectionError("");
    try {
      const prepared = await window.agentDesktop.openIM.prepareDirectConversation({ userID: user.id });
      const result = await openIMSDK.getOneConversation({
        sourceID: prepared.userID,
        sessionType: SessionType.Single,
      });
      setConversations((current) => mergeConversations(current, [result.data]));
      setActiveConversation(result.data);
      setSidebarTab("messages");
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setCreatingConversationUserID("");
    }
  };

  const createDirectoryGroup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedUsers = directory.users.filter((user) => selectedGroupUserIDs.has(user.id));
    if (!groupName.trim() || selectedUsers.length < 2 || creatingGroup) return;
    setCreatingGroup(true);
    setConnectionError("");
    try {
      const prepared = await window.agentDesktop.openIM.prepareGroupConversation({
        userIDs: selectedUsers.map((user) => user.id),
      });
      const created = await openIMSDK.createGroup({
        memberUserIDs: prepared.memberUserIDs,
        groupInfo: { groupID: prepared.groupID, groupName: groupName.trim() },
      });
      const conversation = await openIMSDK.getOneConversation({
        sourceID: created.data.groupID,
        sessionType: SessionType.Group,
      });
      setConversations((current) => mergeConversations(current, [conversation.data]));
      setActiveConversation(conversation.data);
      setGroupCreateOpen(false);
      setGroupName("");
      setSelectedGroupUserIDs(new Set());
      setSidebarTab("messages");
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setCreatingGroup(false);
    }
  };

  const refreshGroupMembers = async () => {
    if (!activeConversation || activeConversation.conversationType === SessionType.Single) return;
    const result = await openIMSDK.getGroupMemberList({
      groupID: activeConversation.groupID,
      filter: GroupMemberFilter.All,
      offset: 0,
      count: 1000,
    });
    setGroupMembers(result.data || []);
  };

  const updateGroupName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConversation?.groupID || !groupNameDraft.trim() || groupManaging) return;
    setGroupManaging(true);
    try {
      await openIMSDK.setGroupInfo({ groupID: activeConversation.groupID, groupName: groupNameDraft.trim() });
      await refreshConversations();
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setGroupManaging(false);
    }
  };

  const inviteGroupMembers = async () => {
    if (!activeConversation?.groupID || !selectedInviteUserIDs.size || groupManaging) return;
    setGroupManaging(true);
    try {
      const selected = directory.users.filter((user) => selectedInviteUserIDs.has(user.id));
      const prepared = await Promise.all(selected.map((user) => (
        window.agentDesktop.openIM.prepareDirectConversation({ userID: user.id })
      )));
      await openIMSDK.inviteUserToGroup({
        groupID: activeConversation.groupID,
        reason: "",
        userIDList: prepared.map((item) => item.userID),
      });
      setSelectedInviteUserIDs(new Set());
      await refreshGroupMembers();
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setGroupManaging(false);
    }
  };

  const removeGroupMember = async (member: GroupMemberItem) => {
    if (!activeConversation?.groupID || groupManaging) return;
    if (!window.confirm(`将 ${member.nickname || member.userID} 移出群聊？`)) return;
    setGroupManaging(true);
    try {
      await openIMSDK.kickGroupMember({
        groupID: activeConversation.groupID,
        reason: "",
        userIDList: [member.userID],
      });
      await refreshGroupMembers();
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setGroupManaging(false);
    }
  };

  const updateConversation = async (patch: Partial<Pick<ConversationItem, "isPinned" | "recvMsgOpt">>) => {
    if (!activeConversation) return;
    try {
      await openIMSDK.setConversation({ conversationID: activeConversation.conversationID, ...patch });
      await refreshConversations();
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const clearConversation = async (remove: boolean) => {
    if (!activeConversation) return;
    if (!window.confirm(remove ? "删除该会话及全部消息？" : "清空该会话的全部消息？")) return;
    try {
      if (remove) await openIMSDK.deleteConversationAndDeleteAllMsg(activeConversation.conversationID);
      else await openIMSDK.clearConversationAndDeleteAllMsg(activeConversation.conversationID);
      setMessages([]);
      if (remove) setActiveConversation(null);
      await refreshConversations();
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const revokeMessage = async (message: MessageItem) => {
    if (!activeConversation) return;
    try {
      await openIMSDK.revokeMessage({ conversationID: activeConversation.conversationID, clientMsgID: message.clientMsgID });
      setMessages((current) => current.map((item) => item.clientMsgID === message.clientMsgID
        ? { ...item, contentType: MessageType.RevokeMessage }
        : item));
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const deleteMessage = async (message: MessageItem) => {
    if (!activeConversation) return;
    try {
      await openIMSDK.deleteMessageFromLocalStorage({ conversationID: activeConversation.conversationID, clientMsgID: message.clientMsgID });
      setMessages((current) => current.filter((item) => item.clientMsgID !== message.clientMsgID));
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const retryMessage = async (message: MessageItem) => {
    if (sending) return;
    setSending(true);
    setConnectionError("");
    try {
      await sendCreatedMessage({ ...message, status: MessageStatus.Sending });
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const downloadable = (message: MessageItem) => {
    if (message.contentType === MessageType.PictureMessage) {
      return { url: message.pictureElem?.sourcePicture?.url || "", name: `${message.clientMsgID}.jpg` };
    }
    if (message.contentType === MessageType.VideoMessage) {
      return { url: message.videoElem?.videoUrl || "", name: `${message.clientMsgID}.mp4` };
    }
    if (message.contentType === MessageType.FileMessage) {
      return { url: message.fileElem?.sourceUrl || "", name: message.fileElem?.fileName || "OpenIM-file" };
    }
    return null;
  };

  const downloadMessage = async (url: string, fileName: string) => {
    try {
      await window.agentDesktop.openIM.download({ url, fileName });
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  const startForward = (items: MessageItem[], mode: "forward" | "merge") => {
    setForwardMessages(items);
    setForwardMode(mode);
    setContextMenu(null);
  };

  const forwardTo = async (target: ConversationItem) => {
    if (!forwardMessages?.length) return;
    setSending(true);
    try {
      if (forwardMode === "merge") {
        const created = await openIMSDK.createMergerMessage({
          messageList: forwardMessages,
          title: activeConversation ? `${activeConversation.showName}的聊天记录` : "聊天记录",
          summaryList: forwardMessages.slice(0, 5).map((message) => `${message.senderNickname}: ${openIMMessageSummary(message)}`),
        });
        await sendCreatedMessage(created.data, target);
      } else {
        for (const message of forwardMessages) {
          const created = await openIMSDK.createForwardMessage(message);
          await sendCreatedMessage(created.data, target);
        }
      }
      setForwardMessages(null);
      setMultiSelect(false);
      setSelectedMessageIDs(new Set());
    } catch (error) {
      setConnectionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const openCardConversation = async (card: CardElem) => {
    setCardPreview(null);
    try {
      const result = await openIMSDK.getOneConversation({ sourceID: card.userID, sessionType: SessionType.Single });
      setConversations((current) => mergeConversations(current, [result.data]));
      setActiveConversation(result.data);
    } catch (error) {
      setConnectionError(errorMessage(error));
    }
  };

  if (!profile) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><MessageSquareText className="h-5 w-5" /></div>
            <div className="text-left"><h1 className="text-lg font-semibold text-foreground">即时消息</h1><div className="text-xs text-muted-foreground">使用 Moss Server 账号连接</div></div>
          </div>
          {initializing ? <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在连接</div> : null}
          {!initializing && connectionError ? <div className="text-sm leading-6 text-destructive">{connectionError}</div> : null}
          {!initializing ? <div className="mt-5 flex justify-center gap-2"><Button type="button" onClick={() => void bootstrap()}><RefreshCw className="h-4 w-4" />重新连接</Button>{appInstance?.enabled ? <Button type="button" variant="outline" onClick={openDefaultPolicy}><Bot className="h-4 w-4" />默认 AI 策略</Button> : appInstance ? <Button type="button" variant="outline" disabled={agentBackendBusy} onClick={() => void enableAgentBackend()}>{agentBackendBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}启用 AI 回复</Button> : null}</div> : null}
        </div>
        {policyTarget ? <OpenIMAgentPolicyDialog instanceId={appInstance?.enabled ? appInstance.id : null} target={policyTarget} onClose={() => setPolicyTarget(null)} /> : null}
      </div>
    );
  }

  const filteredConversations = conversations.filter((item) => item.showName.toLowerCase().includes(query.trim().toLowerCase()));
  const departmentNames = new Map(directory.departments.map((department) => [department.id, department.name]));
  const normalizedQuery = query.trim().toLowerCase();
  const directoryTree = buildDirectoryTree(directory);
  const filteredDirectoryDepartments = directoryTree.departments
    .map((department) => filterDirectoryNode(department, normalizedQuery))
    .filter((department): department is OpenIMDirectoryNode => Boolean(department));
  const filteredRootUsers = directoryTree.users.filter((user) => (
    !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery) ||
    (user.email || "").toLowerCase().includes(normalizedQuery)
  ));
  const visibleMessages = searchResults ?? messages;
  const selectedMessages = messages.filter((message) => selectedMessageIDs.has(message.clientMsgID));
  const selfGroupMember = groupMembers.find((member) => member.userID === selfInfo?.userID);
  const canManageGroup = Boolean(selfGroupMember && selfGroupMember.roleLevel >= GroupMemberRole.Admin);
  const groupMemberIDs = new Set(groupMembers.map((member) => member.userID));
  const inviteCandidates = directory.users.filter((user) => (
    user.id !== profile.user.id && !groupMemberIDs.has(user.openimUserID)
  ));

  const renderDirectoryUser = (user: OpenIMDirectoryUser, depth: number) => {
    const self = user.id === profile.user.id;
    const content = <>
      <Avatar name={user.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{user.name}</span>
          {creatingConversationUserID === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
        {user.email ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{user.email}</div> : null}
      </div>
    </>;
    const style = { paddingLeft: 12 + Math.min(depth, 6) * 16 };
    if (self) {
      return <div key={`user-${user.id}`} className="flex h-12 w-full items-center gap-3 pr-3" style={style}>{content}</div>;
    }
    return (
      <button
        key={`user-${user.id}`}
        type="button"
        disabled={Boolean(creatingConversationUserID)}
        className="flex h-12 w-full items-center gap-3 pr-3 text-left hover:bg-muted/60 disabled:opacity-60"
        style={style}
        onClick={() => void openDirectoryConversation(user)}
      >
        {content}
      </button>
    );
  };

  const renderDirectoryDepartment = (node: OpenIMDirectoryNode, depth: number): React.ReactNode => {
    const hasChildren = Boolean(node.departments.length || node.users.length);
    const collapsed = !normalizedQuery && collapsedDepartmentIDs.has(node.department.id);
    return (
      <React.Fragment key={`department-${node.department.id}`}>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 pr-3 text-left text-sm font-medium hover:bg-muted/60"
          style={{ paddingLeft: 10 + Math.min(depth, 6) * 16 }}
          onClick={() => {
            if (!hasChildren) return;
            setCollapsedDepartmentIDs((current) => {
              const next = new Set(current);
              if (next.has(node.department.id)) next.delete(node.department.id);
              else next.add(node.department.id);
              return next;
            });
          }}
        >
          {hasChildren ? (collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />) : <span className="h-3.5 w-3.5 shrink-0" />}
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{node.department.name}</span>
        </button>
        {!collapsed ? <>
          {node.departments.map((department) => renderDirectoryDepartment(department, depth + 1))}
          {node.users.map((user) => renderDirectoryUser(user, depth + 1))}
        </> : null}
      </React.Fragment>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <MessageSquareText className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">即时消息</div>
        {appInstance?.enabled ? <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={openDefaultPolicy}><Bot className="h-3.5 w-3.5" />默认 AI 策略</Button> : appInstance ? <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={agentBackendBusy} onClick={() => void enableAgentBackend()}>{agentBackendBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}启用 AI 回复</Button> : null}
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {connection === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={cn("h-2 w-2 rounded-full", connection === "connected" ? "bg-emerald-500" : "bg-destructive")} />}
          <span>{connection === "connected" ? "已连接" : connection === "connecting" ? "连接中" : "连接失败"}</span>
        </div>
        <span className="max-w-40 truncate text-xs text-muted-foreground">{selfInfo?.nickname || profile.user.name}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void refreshConversations()} title="刷新会话"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {connectionError ? (
        <div className="flex shrink-0 items-center justify-between border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <span className="truncate">{connectionError}</span><Button type="button" variant="ghost" size="icon-sm" onClick={() => setConnectionError("")}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[31%] min-w-[260px] max-w-[340px] shrink-0 flex-col border-r border-border/70">
          <div className="grid h-10 shrink-0 grid-cols-2 border-b border-border/60 px-2 pt-1">
            <button type="button" className={cn("flex items-center justify-center gap-2 border-b-2 text-xs font-medium", sidebarTab === "messages" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => { setSidebarTab("messages"); setQuery(""); }}><MessageSquareText className="h-3.5 w-3.5" />消息</button>
            <button type="button" className={cn("flex items-center justify-center gap-2 border-b-2 text-xs font-medium", sidebarTab === "directory" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => { setSidebarTab("directory"); setQuery(""); }}><Building2 className="h-3.5 w-3.5" />通讯录</button>
          </div>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={sidebarTab === "messages" ? "搜索会话" : "搜索姓名、邮箱或部门"} className="h-8 pl-8" /></div>
            {sidebarTab === "messages" ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setSidebarTab("directory"); setQuery(""); }} title="发起会话"><MessageSquarePlus className="h-4 w-4" /></Button> : <>{profile.capabilities.createGroup ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setGroupCreateOpen(true)} title="创建群聊"><UsersRound className="h-4 w-4" /></Button> : null}<Button type="button" variant="ghost" size="icon-sm" onClick={() => void refreshDirectory()} title="刷新通讯录"><RefreshCw className="h-4 w-4" /></Button></>}
          </div>
          {sidebarTab === "messages" ? <div className="min-h-0 flex-1 overflow-y-auto">
            {initializing ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />同步中</div> : filteredConversations.length ? filteredConversations.map((conversation) => {
              const latest = latestMessage(conversation);
              const active = activeConversation?.conversationID === conversation.conversationID;
              return (
                <button key={conversation.conversationID} type="button" onClick={() => setActiveConversation(conversation)} className={cn("flex h-[68px] w-full items-center gap-3 border-b border-border/45 px-3 text-left transition-colors", active ? "bg-primary/10" : "hover:bg-muted/60")}>
                  <Avatar name={conversation.showName} url={conversation.faceURL} group={conversation.conversationType !== SessionType.Single} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{conversation.showName}</span>{conversation.isPinned ? <Pin className="h-3 w-3 text-primary" /> : null}<span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(conversation.latestMsgSendTime)}</span></div>
                    <div className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{openIMMessageSummary(latest) || "暂无消息"}</span>{conversation.recvMsgOpt !== MessageReceiveOptType.Normal ? <BellOff className="h-3 w-3 text-muted-foreground" /> : null}{conversation.unreadCount > 0 ? <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span> : null}</div>
                  </div>
                </button>
              );
            }) : <div className="flex h-full flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground"><MessageSquareText className="mb-3 h-6 w-6" />{query ? "未找到会话" : "暂无会话"}</div>}
          </div> : <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filteredDirectoryDepartments.length || filteredRootUsers.length ? <>
              {filteredDirectoryDepartments.map((department) => renderDirectoryDepartment(department, 0))}
              {filteredRootUsers.map((user) => renderDirectoryUser(user, 0))}
            </> : <div className="flex h-full flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground"><UserRound className="mb-3 h-6 w-6" />未找到联系人</div>}
          </div>}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {activeConversation ? (
            <>
              <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-4">
                <Avatar name={activeConversation.showName} url={activeConversation.faceURL} group={activeConversation.conversationType !== SessionType.Single} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-foreground">{activeConversation.showName}</div><div className="truncate text-[11px] text-muted-foreground">{typingLabel || (activeConversation.conversationType === SessionType.Single ? activeConversation.userID : `${activeConversation.groupID} · ${groupMembers.length || ""}人`)}</div></div>
                {activeConversation.conversationType === SessionType.Single && appInstance?.enabled ? <OpenIMAgentActivity instanceId={appInstance.id} conversationId={openIMDirectConversationId(profile.userID, activeConversation.userID)} /> : null}
                {activeConversation.conversationType === SessionType.Single ? <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={!appInstance?.enabled} title={appInstance?.enabled ? "联系人 AI 回复策略" : "请先启用 AI 回复"} onClick={() => setPolicyTarget({ conversationId: openIMDirectConversationId(profile.userID, activeConversation.userID), peerId: activeConversation.userID, title: activeConversation.showName || activeConversation.userID, kind: "contact" })}><Bot className="h-3.5 w-3.5" />AI 策略</Button> : null}
                {profile.rtcEnabled && activeConversation.conversationType === SessionType.Single ? <><Button type="button" variant="ghost" size="icon-sm" title="语音通话" onClick={() => void startCall("audio")}><Phone className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon-sm" title="视频通话" onClick={() => void startCall("video")}><Video className="h-4 w-4" /></Button></> : null}
                {messageSearchOpen ? <div className="relative w-56"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} placeholder="搜索聊天记录" className="h-8 pl-7 pr-7 text-xs" /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setMessageSearchOpen(false); setMessageQuery(""); }}><X className="h-3.5 w-3.5" /></button></div> : <Button type="button" variant="ghost" size="icon-sm" title="搜索聊天记录" onClick={() => setMessageSearchOpen(true)}><Search className="h-4 w-4" /></Button>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" title="会话设置"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {activeConversation.conversationType !== SessionType.Single ? <DropdownMenuItem onSelect={() => { setGroupNameDraft(activeConversation.showName); setSelectedInviteUserIDs(new Set()); setGroupManageOpen(true); }}><UsersRound />群聊成员</DropdownMenuItem> : null}
                    <DropdownMenuItem onSelect={() => void updateConversation({ isPinned: !activeConversation.isPinned })}>{activeConversation.isPinned ? <PinOff /> : <Pin />}{activeConversation.isPinned ? "取消置顶" : "置顶会话"}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void updateConversation({ recvMsgOpt: activeConversation.recvMsgOpt === MessageReceiveOptType.NotNotify ? MessageReceiveOptType.Normal : MessageReceiveOptType.NotNotify })}>{activeConversation.recvMsgOpt === MessageReceiveOptType.NotNotify ? <Bell /> : <BellOff />}{activeConversation.recvMsgOpt === MessageReceiveOptType.NotNotify ? "开启通知" : "消息免打扰"}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void clearConversation(false)}><Trash2 />清空聊天记录</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => void clearConversation(true)}><Trash2 />删除会话</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/15 px-5 py-4" onScroll={(event) => { if (event.currentTarget.scrollTop < 48) void loadOlderMessages(); }}>
                {messagesLoading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载消息</div> : visibleMessages.length ? (
                  <div className="space-y-3">
                    {hasMoreHistory || olderMessagesLoading ? <div className="flex h-7 items-center justify-center text-[11px] text-muted-foreground">{olderMessagesLoading ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />加载更早消息</> : "向上滚动加载更早消息"}</div> : null}
                    {visibleMessages.map((message) => {
                      const mine = message.sendID === selfInfo?.userID;
                      const selected = selectedMessageIDs.has(message.clientMsgID);
                      return (
                        <div key={message.clientMsgID} className={cn("flex items-end gap-3", mine ? "justify-end" : "justify-start")}>
                          {multiSelect ? <button type="button" className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")} onClick={() => setSelectedMessageIDs((current) => { const next = new Set(current); if (next.has(message.clientMsgID)) next.delete(message.clientMsgID); else next.add(message.clientMsgID); return next; })}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</button> : null}
                          {!mine ? <Avatar name={message.senderNickname || message.sendID} url={message.senderFaceUrl} size="message" /> : null}
                          <div className={cn("max-w-[72%]", mine && "text-right")} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, message }); }}>
                            {!mine && activeConversation.conversationType !== SessionType.Single ? <div className="mb-1 px-1 text-[11px] text-muted-foreground">{message.senderNickname}</div> : null}
                            <OpenIMMessageContent message={message} mine={mine} onOpenImage={setImagePreview} onOpenMerge={setMergePreview} onOpenCard={setCardPreview} onDownload={(url, name) => void downloadMessage(url, name)} />
                            {uploadProgress[message.clientMsgID] !== undefined ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/70"><div className="h-full bg-primary transition-[width]" style={{ width: `${uploadProgress[message.clientMsgID]}%` }} /></div> : null}
                            <div className={cn("mt-1 flex items-center gap-2 px-1 text-[10px] text-muted-foreground", mine && "justify-end")}><span>{formatTime(message.sendTime)}</span>{mine && activeConversation.conversationType === SessionType.Single && message.status === MessageStatus.Succeed ? <span>{message.isRead ? "已读" : "未读"}</span> : null}{message.status === MessageStatus.Failed ? <span className="text-destructive">发送失败</span> : null}</div>
                          </div>
                          {mine ? <Avatar name={selfInfo?.nickname || profile.user.name} url={selfInfo?.faceURL} size="message" /> : null}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                ) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{messageQuery ? "未找到消息" : "暂无消息"}</div>}
              </div>
              {activeConversation.conversationType === SessionType.Single && appInstance?.enabled ? <OpenIMPendingReviews instanceId={appInstance.id} conversationId={openIMDirectConversationId(profile.userID, activeConversation.userID)} /> : null}
              {multiSelect ? (
                <div className="flex h-14 shrink-0 items-center justify-between border-t border-border bg-background px-4">
                  <div className="text-xs text-muted-foreground">已选择 {selectedMessageIDs.size} 条消息</div>
                  <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setMultiSelect(false); setSelectedMessageIDs(new Set()); }}>取消</Button><Button variant="outline" size="sm" disabled={!selectedMessages.length} onClick={() => startForward(selectedMessages, "forward")}>逐条转发</Button><Button size="sm" disabled={!selectedMessages.length} onClick={() => startForward(selectedMessages, "merge")}>合并转发</Button></div>
                </div>
              ) : <OpenIMComposer conversation={activeConversation} disabled={connection !== "connected" || sending} sending={sending} replyTo={replyTo} insertion={composerInsertion} onCancelReply={() => setReplyTo(null)} onSend={sendText} onTyping={notifyTyping} onPickAttachment={(kind) => void pickAttachments(kind)} onPickCard={() => setCardPickerOpen(true)} onPickLocation={() => setLocationOpen(true)} onPickMention={() => setMentionPickerOpen(true)} onSendLocalAttachments={(files) => void sendLocalAttachments(files)} onError={setConnectionError} />}
            </>
          ) : <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground"><MessageSquareText className="mb-3 h-8 w-8" />选择一个会话</div>}
        </main>
      </div>

      {busyLabel ? <div className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-xs shadow-lg"><Loader2 className="h-4 w-4 animate-spin" />{busyLabel}</div> : null}

      {policyTarget ? <OpenIMAgentPolicyDialog instanceId={appInstance?.enabled ? appInstance.id : null} target={policyTarget} onClose={() => setPolicyTarget(null)} /> : null}

      {groupCreateOpen ? <ModalShell title="创建群聊" onClose={() => setGroupCreateOpen(false)} width="max-w-lg"><form className="flex min-h-0 flex-1 flex-col" onSubmit={createDirectoryGroup}><div className="border-b border-border p-4"><label htmlFor="openim-group-name" className="mb-2 block text-xs font-medium text-muted-foreground">群聊名称</label><Input id="openim-group-name" autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="输入群聊名称" /></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{directory.users.filter((user) => user.id !== profile.user.id).map((user) => { const selected = selectedGroupUserIDs.has(user.id); return <button key={user.id} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => setSelectedGroupUserIDs((current) => { const next = new Set(current); if (next.has(user.id)) next.delete(user.id); else next.add(user.id); return next; })}><span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</span><Avatar name={user.name} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user.name}</span><span className="block truncate text-xs text-muted-foreground">{user.departmentId ? departmentNames.get(user.departmentId) || "未分配部门" : "未分配部门"}</span></span></button>; })}</div><div className="flex items-center justify-between border-t border-border px-4 py-3"><span className="text-xs text-muted-foreground">已选择 {selectedGroupUserIDs.size} 人</span><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setGroupCreateOpen(false)}>取消</Button><Button type="submit" disabled={creatingGroup || !groupName.trim() || selectedGroupUserIDs.size < 2}>{creatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : null}创建</Button></div></div></form></ModalShell> : null}

      {groupManageOpen && activeConversation?.conversationType !== SessionType.Single ? <ModalShell title="群聊成员" onClose={() => setGroupManageOpen(false)} width="max-w-xl"><div className="flex min-h-0 flex-1 flex-col">{canManageGroup ? <form className="flex items-center gap-2 border-b border-border p-3" onSubmit={updateGroupName}><Input value={groupNameDraft} onChange={(event) => setGroupNameDraft(event.target.value)} className="h-8" /><Button type="submit" size="sm" disabled={groupManaging || !groupNameDraft.trim()}>保存名称</Button></form> : null}<div className="min-h-0 flex-1 overflow-y-auto"><div className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">当前成员 · {groupMembers.length}</div>{groupMembers.map((member) => { const canRemove = canManageGroup && member.userID !== selfInfo?.userID && (selfGroupMember?.roleLevel === GroupMemberRole.Owner || member.roleLevel === GroupMemberRole.Normal); return <div key={member.userID} className="flex h-12 items-center gap-3 px-4 hover:bg-muted/50"><Avatar name={member.nickname} url={member.faceURL} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{member.nickname || member.userID}</span>{member.roleLevel === GroupMemberRole.Owner ? <span className="text-[11px] text-muted-foreground">群主</span> : member.roleLevel === GroupMemberRole.Admin ? <span className="text-[11px] text-muted-foreground">管理员</span> : null}{canRemove ? <Button type="button" variant="ghost" size="icon-sm" title="移出群聊" disabled={groupManaging} onClick={() => void removeGroupMember(member)}><X className="h-4 w-4" /></Button> : null}</div>; })}{canManageGroup && inviteCandidates.length ? <><div className="border-t border-border px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">添加成员</div>{inviteCandidates.map((user) => { const selected = selectedInviteUserIDs.has(user.id); return <button key={user.id} type="button" className="flex h-12 w-full items-center gap-3 px-4 text-left hover:bg-muted/50" onClick={() => setSelectedInviteUserIDs((current) => { const next = new Set(current); if (next.has(user.id)) next.delete(user.id); else next.add(user.id); return next; })}><span className={cn("flex h-5 w-5 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</span><Avatar name={user.name} size="sm" /><span className="truncate text-sm">{user.name}</span></button>; })}</> : null}</div>{canManageGroup && inviteCandidates.length ? <div className="flex items-center justify-between border-t border-border px-4 py-3"><span className="text-xs text-muted-foreground">已选择 {selectedInviteUserIDs.size} 人</span><Button type="button" size="sm" disabled={groupManaging || !selectedInviteUserIDs.size} onClick={() => void inviteGroupMembers()}>{groupManaging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}添加</Button></div> : null}</div></ModalShell> : null}

      {contextMenu ? (
        <div className="fixed z-[90] w-36 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg" style={{ left: Math.min(contextMenu.x, window.innerWidth - 160), top: Math.min(contextMenu.y, window.innerHeight - 280) }} onPointerDown={(event) => event.stopPropagation()}>
          {[MessageType.TextMessage, MessageType.AtTextMessage, MessageType.QuoteMessage].includes(contextMenu.message.contentType) ? <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { void navigator.clipboard.writeText(openIMMessageSummary(contextMenu.message)); setContextMenu(null); }}><Copy className="h-4 w-4" />复制</button> : null}
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { setReplyTo(contextMenu.message); setContextMenu(null); }}><MessageSquareReply className="h-4 w-4" />回复</button>
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => startForward([contextMenu.message], "forward")}><Forward className="h-4 w-4" />转发</button>
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { setMultiSelect(true); setSelectedMessageIDs(new Set([contextMenu.message.clientMsgID])); setContextMenu(null); }}><Check className="h-4 w-4" />多选</button>
          {contextMenu.message.status === MessageStatus.Failed ? <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { void retryMessage(contextMenu.message); setContextMenu(null); }}><RefreshCw className="h-4 w-4" />重新发送</button> : null}
          {contextMenu.message.sendID === selfInfo?.userID ? <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { void revokeMessage(contextMenu.message); setContextMenu(null); }}><MessageSquareReply className="h-4 w-4" />撤回</button> : null}
          {downloadable(contextMenu.message) ? <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted" onClick={() => { const item = downloadable(contextMenu.message); if (item) void downloadMessage(item.url, item.name); setContextMenu(null); }}><Download className="h-4 w-4" />下载</button> : null}
          <div className="my-1 h-px bg-border" />
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-destructive/10" onClick={() => { void deleteMessage(contextMenu.message); setContextMenu(null); }}><Trash2 className="h-4 w-4" />删除</button>
        </div>
      ) : null}

      {cardPickerOpen ? <ModalShell title="发送个人名片" onClose={() => setCardPickerOpen(false)}><div className="min-h-0 overflow-y-auto p-2">{directory.users.filter((user) => user.id !== profile.user.id).length ? directory.users.filter((user) => user.id !== profile.user.id).map((user) => <button key={user.id} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => void sendCard(user)}><Avatar name={user.name} size="sm" /><div className="min-w-0"><div className="truncate text-sm font-medium">{user.name}</div><div className="truncate text-xs text-muted-foreground">{user.departmentId ? departmentNames.get(user.departmentId) || "未分配部门" : "未分配部门"}</div></div></button>) : <div className="p-8 text-center text-sm text-muted-foreground">暂无联系人</div>}</div></ModalShell> : null}

      {mentionPickerOpen ? <ModalShell title="选择群成员" onClose={() => setMentionPickerOpen(false)}><div className="min-h-0 overflow-y-auto p-2">{groupMembers.filter((member) => member.userID !== selfInfo?.userID).map((member) => <button key={member.userID} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => { setMentionIDs((current) => current.includes(member.userID) ? current : [...current, member.userID]); setComposerInsertion({ key: Date.now(), text: `@${member.nickname}` }); setMentionPickerOpen(false); }}><Avatar name={member.nickname} url={member.faceURL} size="sm" /><div className="min-w-0"><div className="truncate text-sm font-medium">{member.nickname}</div><div className="truncate text-xs text-muted-foreground">{member.userID}</div></div></button>)}</div></ModalShell> : null}

      {locationOpen ? <ModalShell title="发送位置" onClose={() => setLocationOpen(false)}><form onSubmit={sendLocation}><div className="space-y-3 p-4"><div><label className="mb-1.5 block text-xs text-muted-foreground">位置名称</label><Input value={locationDescription} onChange={(event) => setLocationDescription(event.target.value)} placeholder="例如：公司总部" /></div><div className="grid grid-cols-2 gap-3"><div><label className="mb-1.5 block text-xs text-muted-foreground">纬度</label><Input inputMode="decimal" value={locationLatitude} onChange={(event) => setLocationLatitude(event.target.value)} placeholder="31.2304" /></div><div><label className="mb-1.5 block text-xs text-muted-foreground">经度</label><Input inputMode="decimal" value={locationLongitude} onChange={(event) => setLocationLongitude(event.target.value)} placeholder="121.4737" /></div></div></div><div className="flex justify-end gap-2 border-t border-border px-4 py-3"><Button type="button" variant="outline" onClick={() => setLocationOpen(false)}>取消</Button><Button type="submit" disabled={!locationLatitude || !locationLongitude || sending}>发送</Button></div></form></ModalShell> : null}

      {forwardMessages ? <ModalShell title={forwardMode === "merge" ? "合并转发到" : "转发到"} onClose={() => setForwardMessages(null)}><div className="min-h-0 overflow-y-auto p-2">{conversations.map((conversation) => <button key={conversation.conversationID} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => void forwardTo(conversation)}><Avatar name={conversation.showName} url={conversation.faceURL} group={conversation.conversationType !== SessionType.Single} size="sm" /><div className="min-w-0"><div className="truncate text-sm font-medium">{conversation.showName}</div><div className="truncate text-xs text-muted-foreground">{openIMMessageSummary(latestMessage(conversation))}</div></div></button>)}</div></ModalShell> : null}

      {imagePreview ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-8" onClick={() => setImagePreview("")}><Button type="button" variant="secondary" size="icon" className="absolute right-5 top-5" onClick={() => setImagePreview("")}><X className="h-4 w-4" /></Button><img src={imagePreview} alt="图片预览" className="max-h-full max-w-full object-contain" /></div> : null}

      {mergePreview?.mergeElem ? <ModalShell title={mergePreview.mergeElem.title || "聊天记录"} onClose={() => setMergePreview(null)} width="max-w-2xl"><div className="min-h-0 overflow-y-auto p-4"><div className="space-y-4">{mergePreview.mergeElem.multiMessage.map((message) => <div key={message.clientMsgID} className="flex gap-3"><Avatar name={message.senderNickname} url={message.senderFaceUrl} size="sm" /><div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-3"><span className="truncate text-xs font-medium">{message.senderNickname}</span><span className="text-[10px] text-muted-foreground">{formatTime(message.sendTime)}</span></div><OpenIMMessageContent message={message} mine={false} onOpenImage={setImagePreview} onOpenMerge={setMergePreview} onOpenCard={setCardPreview} onDownload={(url, name) => void downloadMessage(url, name)} /></div></div>)}</div></div></ModalShell> : null}

      {cardPreview ? <ModalShell title="个人名片" onClose={() => setCardPreview(null)}><div className="flex flex-col items-center p-6 text-center"><Avatar name={cardPreview.nickname} url={cardPreview.faceURL} /><div className="mt-3 text-base font-semibold">{cardPreview.nickname}</div><div className="mt-1 text-xs text-muted-foreground">{cardPreview.userID}</div><Button className="mt-5" onClick={() => void openCardConversation(cardPreview)}><ContactRound className="h-4 w-4" />发消息</Button></div></ModalShell> : null}
      {rtcCall && selfInfo ? <OpenIMRtcCall profile={profile} selfUserID={selfInfo.userID} call={rtcCall} onClose={closeRtcCall} /> : null}
    </div>
  );
}
