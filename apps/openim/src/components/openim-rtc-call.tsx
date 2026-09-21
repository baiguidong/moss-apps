"use client";

import "@livekit/components-styles";

import * as React from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  TrackLoop,
  TrackRefContext,
  TrackToggle,
  useConnectionState,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { CbEvents, MessageType, SessionType, type MessageItem, type WSEvent } from "@openim/wasm-client-sdk";
import { ConnectionState, LocalParticipant, Track } from "livekit-client";
import { Camera, Loader2, Mic, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openIMSDK, type OpenIMProfile } from "@/lib/openim-sdk";

export enum OpenIMCallSignal {
  Invite = 200,
  Accept = 201,
  Reject = 202,
  Cancel = 203,
  Hangup = 204,
}

export type OpenIMCallInvitation = {
  inviterUserID: string;
  inviteeUserIDList: string[];
  groupID: string;
  roomID: string;
  timeout: number;
  mediaType: "audio" | "video";
  sessionType: SessionType;
  platformID: number;
};

export type OpenIMCallState = {
  invitation: OpenIMCallInvitation;
  incoming: boolean;
  peer: { userID: string; nickname: string; faceURL: string };
};

export function parseOpenIMCallSignal(message: MessageItem) {
  if (message.contentType !== MessageType.CustomMessage || !message.customElem?.data) return null;
  try {
    const parsed = JSON.parse(message.customElem.data) as { customType?: number; data?: OpenIMCallInvitation };
    if (!parsed.data || parsed.customType === undefined || parsed.customType < 200 || parsed.customType > 204) return null;
    return { signal: parsed.customType as OpenIMCallSignal, invitation: parsed.data };
  } catch {
    return null;
  }
}

async function sendSignal(invitation: OpenIMCallInvitation, signal: OpenIMCallSignal, recvID: string) {
  const created = await openIMSDK.createCustomMessage({
    data: JSON.stringify({ customType: signal, data: invitation }),
    extension: "",
    description: "OpenIM RTC",
  });
  await openIMSDK.sendMessage({ recvID, groupID: "", message: created.data, isOnlineOnly: true });
}

function CallStage({ call, connected, onHangup }: {
  call: OpenIMCallState;
  connected: boolean;
  onHangup: () => void;
}) {
  const tracks = useTracks([Track.Source.Camera]);
  const connectionState = useConnectionState();
  const isVideo = call.invitation.mediaType === "video";
  const remoteTrack = tracks.find((item) => !(item.participant instanceof LocalParticipant));

  return (
    <div className="relative h-[min(620px,82vh)] w-[min(920px,88vw)] overflow-hidden rounded-lg bg-neutral-950 text-white shadow-2xl">
      {connected && isVideo && remoteTrack ? (
        <TrackRefContext.Provider value={remoteTrack}>
          <VideoTrack className="absolute inset-0 h-full w-full object-cover" />
        </TrackRefContext.Provider>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-white/10 text-2xl font-semibold">
            {call.peer.faceURL ? <img src={call.peer.faceURL} alt="" className="h-full w-full object-cover" /> : call.peer.nickname.slice(0, 1)}
          </div>
          <div className="mt-4 text-lg font-medium">{call.peer.nickname}</div>
          <div className="mt-2 flex items-center gap-2 text-sm text-white/65">
            {connectionState === ConnectionState.Connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {connected ? "通话中" : call.incoming ? "邀请你通话" : "等待对方接听"}
          </div>
        </div>
      )}

      {connected && isVideo ? (
        <TrackLoop tracks={tracks.filter((item) => item.participant instanceof LocalParticipant)}>
          <TrackRefContext.Consumer>
            {(track) => track ? <VideoTrack {...track} className="absolute right-4 top-4 z-10 h-40 w-28 rounded-md bg-neutral-900 object-cover shadow-lg" /> : null}
          </TrackRefContext.Consumer>
        </TrackLoop>
      ) : null}

      <div className="absolute inset-x-0 bottom-7 z-20 flex items-center justify-center gap-5">
        {connected ? (
          <TrackToggle source={Track.Source.Microphone} showIcon={false} className="!flex !h-12 !w-12 !items-center !justify-center !rounded-full !border-0 !bg-white/15 !p-0 hover:!bg-white/25">
            <Mic className="h-5 w-5" />
          </TrackToggle>
        ) : null}
        <Button type="button" size="icon" className="h-12 w-12 rounded-full bg-red-500 text-white hover:bg-red-600" onClick={onHangup} title="挂断">
          <PhoneOff className="h-5 w-5" />
        </Button>
        {connected && isVideo ? (
          <TrackToggle source={Track.Source.Camera} showIcon={false} className="!flex !h-12 !w-12 !items-center !justify-center !rounded-full !border-0 !bg-white/15 !p-0 hover:!bg-white/25">
            <Camera className="h-5 w-5" />
          </TrackToggle>
        ) : null}
      </div>
      <RoomAudioRenderer />
    </div>
  );
}

export function OpenIMRtcCall({ profile, selfUserID, call, onClose }: {
  profile: OpenIMProfile;
  selfUserID: string;
  call: OpenIMCallState;
  onClose: () => void;
}) {
  const [auth, setAuth] = React.useState<{ serverUrl: string; token: string } | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState("");
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const invitation = call.invitation;
  const recvID = call.incoming ? invitation.inviterUserID : invitation.inviteeUserIDList[0];

  const connect = React.useCallback(async () => {
    if (!profile.chatToken) throw new Error("通话登录信息缺失，请退出后重新登录");
    const result = await window.agentDesktop.openIM.getRtcToken({
      chatToken: profile.chatToken,
      room: invitation.roomID,
      identity: selfUserID,
    });
    setAuth(result);
  }, [invitation.roomID, profile.chatToken, selfUserID]);

  React.useEffect(() => {
    let closed = false;
    const handleSignals = (event: WSEvent<MessageItem | MessageItem[]>) => {
      const messages = Array.isArray(event.data) ? event.data : event.data ? [event.data] : [];
      messages.forEach((message) => {
        const parsed = parseOpenIMCallSignal(message);
        if (!parsed || parsed.invitation.roomID !== invitation.roomID) return;
        if (parsed.signal === OpenIMCallSignal.Accept && !call.incoming) {
          void connect().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
        }
        if ([OpenIMCallSignal.Reject, OpenIMCallSignal.Cancel, OpenIMCallSignal.Hangup].includes(parsed.signal)) {
          closed = true;
          onClose();
        }
      });
    };
    void openIMSDK.on(CbEvents.OnRecvNewMessage, handleSignals);
    void openIMSDK.on(CbEvents.OnRecvNewMessages, handleSignals);
    if (!call.incoming) {
      void sendSignal(invitation, OpenIMCallSignal.Invite, recvID).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }
    timeoutRef.current = setTimeout(() => {
      if (closed) return;
      void sendSignal(invitation, call.incoming ? OpenIMCallSignal.Reject : OpenIMCallSignal.Cancel, recvID).catch(() => {});
      onClose();
    }, invitation.timeout * 1000);
    return () => {
      closed = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      void openIMSDK.off(CbEvents.OnRecvNewMessage, handleSignals);
      void openIMSDK.off(CbEvents.OnRecvNewMessages, handleSignals);
    };
  }, [call.incoming, connect, invitation, onClose, recvID]);

  React.useEffect(() => {
    if (auth && timeoutRef.current) clearTimeout(timeoutRef.current);
  }, [auth]);

  const accept = async () => {
    try {
      await sendSignal(invitation, OpenIMCallSignal.Accept, recvID);
      await connect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const hangup = () => {
    const signal = connected
      ? OpenIMCallSignal.Hangup
      : call.incoming ? OpenIMCallSignal.Reject : OpenIMCallSignal.Cancel;
    void sendSignal(invitation, signal, recvID).catch(() => {});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm">
      {auth ? (
        <LiveKitRoom
          serverUrl={auth.serverUrl}
          token={auth.token}
          connect
          audio
          video={invitation.mediaType === "video"}
          onConnected={() => setConnected(true)}
          onDisconnected={() => {
            setConnected(false);
            setError("媒体服务连接已断开");
          }}
          onError={(reason) => setError(reason.message || "媒体服务连接失败")}
        >
          <CallStage call={call} connected={connected} onHangup={hangup} />
          {error ? <div className="absolute left-1/2 top-6 z-[120] -translate-x-1/2 rounded-md bg-red-500/90 px-4 py-2 text-xs text-white shadow-lg">{error}</div> : null}
        </LiveKitRoom>
      ) : (
        <div className="relative flex h-[340px] w-[480px] flex-col items-center justify-center rounded-lg border border-border bg-background shadow-2xl">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-xl font-semibold text-primary">
            {call.peer.faceURL ? <img src={call.peer.faceURL} alt="" className="h-full w-full object-cover" /> : call.peer.nickname.slice(0, 1)}
          </div>
          <div className="mt-4 text-base font-semibold">{call.peer.nickname}</div>
          <div className="mt-1 text-sm text-muted-foreground">{call.incoming ? `邀请你进行${invitation.mediaType === "video" ? "视频" : "语音"}通话` : "正在等待对方接听"}</div>
          {error ? <div className="mt-3 max-w-sm text-center text-xs text-destructive">{error}</div> : null}
          <div className="mt-8 flex items-center gap-5">
            <Button type="button" size="icon" className="h-12 w-12 rounded-full bg-red-500 text-white hover:bg-red-600" onClick={hangup} title={call.incoming ? "拒绝" : "取消"}><PhoneOff className="h-5 w-5" /></Button>
            {call.incoming ? <Button type="button" size="icon" className="h-12 w-12 rounded-full" onClick={() => void accept()} title="接听">{invitation.mediaType === "video" ? <Camera className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</Button> : null}
          </div>
        </div>
      )}
    </div>
  );
}
