import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Button, ConfigProvider, Form, Input, InputNumber, Radio, Segmented, Select, Spin, Switch, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QRCodeSVG } from 'qrcode.react'
import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import { channels, type Kind, type ChannelSettings, type ChannelStatus, type RegistrationStatus } from './contracts'
import { channelCatalog, ToolList, toolsForAssistant } from './tool-settings'
import './theme-vars.css'
import './channel.css'

type ToolMode = 'default' | 'selected'
type ConnectionForm = Omit<ChannelSettings, 'allowedTools' | 'allowedUserIds' | 'allowedChannelIds'> & {
  token?: string
  proxyAuth?: string
  allowedUserIds?: string
  allowedChannelIds?: string
  toolMode?: ToolMode
  allowedTools?: string[]
}
type Instance = { id: string; config?: Partial<ChannelSettings> }
type Registration = Extract<RegistrationStatus, { status: 'finished' }>
const bridge = (window as Window & { mossApp?: AppUiApi }).mossApp
const app = bridge ? createAppClient(bridge) : undefined

const formatError = (error: unknown) => error instanceof Error ? error.message : String(error)

function QrPanel({ name, idLabel, state, onRegenerate, onRetry, saving }: {
  name: string
  idLabel: string
  state: RegistrationStatus
  onRegenerate: () => void
  onRetry: () => void
  saving: boolean
}) {
  if (state.status === 'failed') return (
    <div className="qrPanel">
      <Alert type="error" showIcon message={state.reason} style={{ width: '100%' }} />
      <Button disabled={saving} onClick={onRegenerate}>重新生成</Button>
    </div>
  )
  if (state.status === 'finished') return (
    <div className="qrPanel">
      <Alert type="success" showIcon message="扫码已确认" description={idLabel + '：' + state.accountId} style={{ width: '100%' }} />
      <Button type="primary" loading={saving} onClick={onRetry}>保存</Button>
    </div>
  )
  const url = state.status === 'running' ? state.qr_url : undefined
  const steps = ['打开' + name, '扫描二维码', '确认授权']
  return (
    <div className="qrPanel">
      <div className="qrSteps">
        {steps.map((step, index) => (
          <div className="qrStepGroup" key={step}>
            {index > 0 && <span className="qrStepDivider" />}
            <div className="qrStep"><span className="qrDot">{index + 1}</span>{step}</div>
          </div>
        ))}
      </div>
      <div className="qrCardWrap">
        <div className="qrFrame" aria-label={url ? '扫码二维码' : '生成二维码中'}>
          {url ? <QRCodeSVG value={url} size={200} /> : <Spin />}
        </div>
      </div>
      <p className="qrScanHint">
        {url ? '请使用' + name + '扫码并确认授权' : '正在准备二维码，首次使用会下载通道依赖…'}
        {state.status === 'running' && state.code && <span> 授权码 {state.code}</span>}
      </p>
      <Button size="small" style={{ marginTop: 4, visibility: url ? 'visible' : 'hidden' }} disabled={saving} onClick={onRegenerate}>
        重新生成
      </Button>
    </div>
  )
}

const groupDefaults = { visibility: 'auto', activation: 'mention', history_limit: 10, clear_after_reply: true }
function parseIds(value = '') {
  const ids = [...new Set(value.trim().split(/[,，\s]+/).filter(Boolean))]
  if (ids.some(id => !/^\d+$/.test(id))) throw new Error('请输入数字 ID，多个 ID 可用逗号或空格分开。')
  return ids
}
function App({ kind }: { kind: Kind }) {
  const spec = channels[kind]
  const quick = !!spec.id
  const [manual, setManual] = useState(!quick)
  const [form] = Form.useForm<ConnectionForm>()
  const [instance, setInstance] = useState<Instance>()
  const [status, setStatus] = useState<ChannelStatus>()
  const [catalog, setCatalog] = useState<ReturnType<typeof channelCatalog>>()
  const catalogForSave = useRef<ReturnType<typeof channelCatalog>>(undefined)
  const [catalogError, setCatalogError] = useState('')
  const [editing, setEditing] = useState(false)
  const [qr, setQr] = useState<RegistrationStatus>({ status: 'not_started' })
  const [generation, setGeneration] = useState(0)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const responseMode = Form.useWatch('responseMode', form)
  const agentId = Form.useWatch('agentId', form)
  const toolMode = Form.useWatch('toolMode', form)
  const toolIds = Form.useWatch('allowedTools', { form, preserve: true })
  const selectedId = Form.useWatch('accountId', form)
  const allChannels = Form.useWatch('allowAllChannels', form)
  const visibility = Form.useWatch(['groupContext', 'visibility'], form)
  const availableTools = toolsForAssistant(catalog?.tools ?? [], catalog?.assistants.find(agent => agent.value === agentId))
  const invalidToolSelection = toolMode === 'selected' && (!toolIds?.length ||
    toolIds.some(id => !availableTools.some(tool => tool.id === id)))

  const loadCatalog = useCallback(async () => {
    setCatalogError('')
    try {
      const result = await app?.host.request('moss.agent/v1', 'catalog.list', { kinds: ['agents', 'tools'] })
      if (result) {
        catalogForSave.current = channelCatalog(result)
        setCatalog(catalogForSave.current)
      }
    } catch {
      setCatalogError('无法读取 Moss 的工具列表')
    }
  }, [])

  const load = useCallback(async () => {
    if (!app) throw new Error('请在 Moss 桌面客户端打开渠道 App。')
    const [instances, connection] = await Promise.all([
      app.instances.list(),
      app.actions.invoke<ChannelStatus>('status.get'),
    ])
    const current = instances[0] as Instance | undefined
    if (!current) throw new Error('渠道 App 实例尚未就绪。')
    setInstance(current)
    setStatus(connection)
    return current
  }, [])

  const show = useCallback((current: Instance, isEdit: boolean) => {
    form.resetFields()
    form.setFieldsValue({
      ...current.config,
      accountId: current.config?.accountId,
      allowAllChannels: current.config?.allowAllChannels ?? true,
      allowedUserIds: current.config?.allowedUserIds?.join(', '),
      allowedChannelIds: current.config?.allowedChannelIds?.join(', '),
      groupContext: current.config?.groupContext ?? groupDefaults,
      agentId: current.config?.agentId ?? '',
      responseMode: current.config?.responseMode ?? 'stream',
      showThinking: current.config?.showThinking ?? false,
      showToolHints: current.config?.showToolHints ?? false,
      toolMode: Array.isArray(current.config?.allowedTools) ? 'selected' : 'default',
      allowedTools: current.config?.allowedTools ?? [],
    })
    setManual(!quick || isEdit)
    setEditing(isEdit)
    setError('')
    setFeedback('')
  }, [form, quick])

  useEffect(() => {
    void load().then(current => show(current, false))
      .catch(reason => setError(formatError(reason))).finally(() => setLoading(false))
    void loadCatalog()
  }, [load, loadCatalog, show])

  useEffect(() => {
    if (!app || (!editing && quick) || busy) return
    const actions = app.actions
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const next = await actions.invoke<ChannelStatus>('status.get')
        if (!cancelled) setStatus(next)
      } catch {
        if (!cancelled) setStatus(last => last && { ...last, connected: false, error: '暂时无法读取连接状态，正在重试' })
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 3000)
      }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [busy, editing, quick])

  const save = useCallback(async (values: ConnectionForm, created?: Registration) => {
    if (!app || !instance || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setFeedback('')
    const previous = instance.config
    const accountId = created?.accountId ?? values.accountId?.trim()
    const token = created?.token ?? values.token?.trim()
    try {
      if ((quick && !accountId) || (!token && (!status?.configured || (quick && accountId !== previous?.accountId)))) {
        throw new Error('请填写' + (quick ? spec.id + ' 和 ' : '') + spec.secret)
      }
      const allowedTools = values.toolMode === 'selected' ? values.allowedTools ?? [] : null
      if (allowedTools !== null) {
        const catalog = catalogForSave.current
        const available = toolsForAssistant(catalog?.tools ?? [], catalog?.assistants.find(agent => agent.value === values.agentId))
        if (!allowedTools.length || allowedTools.some(id => !available.some(tool => tool.id === id))) {
          throw new Error('请选择至少一个可用工具，并取消勾选不可用的工具')
        }
      }
      const config = {
        ...previous,
        ...(quick && { accountId }),
        ...(!quick && { httpProxy: values.httpProxy?.trim() || '', allowedUserIds: parseIds(values.allowedUserIds) }),
        ...(kind === 'discord' && { allowAllChannels: values.allowAllChannels ?? true, allowedChannelIds: parseIds(values.allowedChannelIds) }),
        ...(kind === 'wecom' && { websocketUrl: values.websocketUrl?.trim() || '' }),
        ...(kind === 'qq' && { groupContext: { ...groupDefaults, ...values.groupContext,
          activation: values.groupContext?.visibility === 'all' ? values.groupContext.activation : 'mention' } }),
        agentId: values.agentId || null,
        responseMode: values.responseMode ?? 'stream',
        showThinking: values.showThinking ?? previous?.showThinking ?? false,
        showToolHints: values.showToolHints ?? previous?.showToolHints ?? false,
        allowedTools,
      }
      await app.instances.update(instance.id, {
        config,
        ...((token || (kind === 'discord' && values.proxyAuth !== undefined)) && {
          secrets: { ...(token && { token }), ...(kind === 'discord' && values.proxyAuth !== undefined && { proxyAuth: values.proxyAuth.trim() }) },
        }),
      })
      setManual(true)
      setEditing(true)
      setQr({ status: 'not_started' })
      form.resetFields()
      form.setFieldsValue({
        ...config, allowedUserIds: config.allowedUserIds?.join(', '), allowedChannelIds: config.allowedChannelIds?.join(', '), agentId: config.agentId ?? '',
        toolMode: allowedTools === null ? 'default' : 'selected', allowedTools: allowedTools ?? [],
      })
      setFeedback('配置保存成功')
      await load()
    } catch (reason) {
      setError(formatError(reason))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }, [form, instance, load, status?.configured, kind, quick, spec])

  useEffect(() => {
    if (!app || loading || !instance || manual) return
    const actions = app.actions
    let cancelled = false
    let id: string | undefined
    let timer: ReturnType<typeof setTimeout>
    setQr({ status: 'not_started' })
    const poll = async () => {
      if (cancelled) return
      try {
        const result = await actions.invoke<RegistrationStatus>('login.poll', { id })
        if (cancelled) return
        setQr(result)
        if (result.status === 'finished') {
          await save(form.getFieldsValue(true), result)
        } else if (result.status === 'running') {
          timer = setTimeout(poll, 1500)
        } else if (result.status === 'not_started') {
          setQr({ status: 'failed', reason: '扫码已结束，请重新生成' })
        }
      } catch (reason) {
        if (!cancelled) setQr({ status: 'failed', reason: formatError(reason) })
      }
    }
    void actions.invoke<{ id: string }>('login.start').then(result => {
      id = result.id
      if (cancelled) void actions.invoke('login.stop', { id }).catch(() => {})
      else void poll()
    }).catch(reason => {
      if (!cancelled) setQr({ status: 'failed', reason: formatError(reason) })
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (id) void actions.invoke('login.stop', { id }).catch(() => {})
    }
  }, [manual, form, generation, instance, loading, save])

  return (
    <main aria-label={spec.name + '通道'} className="channelPage">
      <Form form={form} layout="vertical" disabled={busy} scrollToFirstError={{ focus: true }}
        onValuesChange={() => setFeedback('')} onFinish={() => void save(form.getFieldsValue(true))}>
        {loading && <div className="channelLoading"><Spin /></div>}
        {error && <Alert className="formNotice" type="error" showIcon message={error} />}
        {feedback && <Alert className="formNotice" type="success" showIcon message={feedback} />}
        {!loading && instance && status && (
          <>
            <div className="channelHeader">
              <div className="channelHeading">
                {editing && quick && (
                  <Button type="text" className="channelBack" disabled={busy} aria-label="返回扫码配置"
                    title="返回扫码配置" onClick={() => show(instance, false)} icon={
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m12 19-7-7 7-7M5 12h14" />
                      </svg>
                    } />
                )}
                <h1>{editing || !quick ? spec.name + '连接' : '新建通道'}</h1>
              </div>
              {status.configured && (
                <div className="channelActions">
                  {editing || !quick ? (
                    <>
                      <span role="status">{status.connected ? '连接正常' : status.error ? '已断开' : '连接中'}</span>
                      <Button size="small" disabled={busy}
                        onClick={() => void load().catch(reason => setError(formatError(reason)))}>刷新</Button>
                    </>
                  ) : (
                    <Button size="small" disabled={busy} onClick={() => show(instance, true)}>查看当前配置</Button>
                  )}
                </div>
              )}
            </div>
            {status.progressUnavailable && responseMode === 'stream' && (
              <Alert className="formNotice" type="info" showIcon message="当前 Moss 可发送最终回复。思考状态和工具调用提示需要升级 Moss。" />
            )}
            {status.error && <Alert className="formNotice" type="warning" showIcon message={status.error} />}
            {quick && !editing && <Segmented className="configModeSwitch" block value={manual ? 'manual' : 'quick'}
              onChange={mode => { setManual(mode === 'manual'); setError(''); setFeedback('') }}
              options={[{label:'快捷配置（扫码）',value:'quick'}, {label:'手动填写',value:'manual'}]} />}
            {manual ? <section className="credentialFields" aria-label="机器人凭据">
              <div className="credentialGuide">
                <p>{spec.guide}</p>
                <Button type="link" className="credentialLink" onClick={() => void app?.host.request('moss.platform/v1',
                  'shell.open-external', { url: spec.url }).catch(reason => setError(formatError(reason)))}>
                  {kind === 'telegram' ? '打开 BotFather' : '打开' + spec.name + '管理平台'}
                </Button>
              </div>
              <div className="credentialGrid">
                {quick && <Form.Item name="accountId" label={spec.id} rules={[{required:true,whitespace:true,message:'请输入 ' + spec.id}]}>
                  <Input className="credentialInput" autoComplete="off" placeholder={spec.id} />
                </Form.Item>}
                <Form.Item name="token" label={spec.secret}>
                  <Input.Password className="credentialInput" autoComplete="new-password"
                    placeholder={status.configured && (!quick || selectedId === instance.config?.accountId) ? '已保存，留空保留' : '请输入 ' + spec.secret} />
                </Form.Item>
              </div>
              {!quick && <>
                <Form.Item name="httpProxy" label="HTTP Proxy（可选）"><Input className="credentialInput" placeholder="http://127.0.0.1:18118" /></Form.Item>
                {kind === 'discord' && <>
                  <Form.Item name="proxyAuth" label="代理认证（可选）"><Input.Password className="credentialInput" autoComplete="new-password" placeholder="user:password" /></Form.Item>
                  <Form.Item name="allowAllChannels" label="允许所有服务器频道" valuePropName="checked"><Switch /></Form.Item>
                  {allChannels === false && <Form.Item name="allowedChannelIds" label="允许的频道 ID" extra="多个 ID 可用逗号分隔，留空将不接收服务器消息。"><Input.TextArea className="credentialInput" /></Form.Item>}
                </>}
                <Form.Item name="allowedUserIds" label={kind === 'discord' ? '允许私聊的用户 ID' : '允许的用户 ID'}
                  extra={kind === 'discord' ? '留空将不接收私信。多个 ID 可用逗号分隔。' : '留空允许所有用户，多个 ID 可用逗号分隔。'}>
                  <Input.TextArea className="credentialInput" /></Form.Item>
              </>}
              {kind === 'wecom' && <Form.Item name="websocketUrl" label="WebSocket URL（可选）"><Input className="credentialInput" placeholder="wss://openws.work.weixin.qq.com" /></Form.Item>}
            </section> : <QrPanel name={spec.name} idLabel={spec.id} state={qr} saving={busy} onRegenerate={() => setGeneration(g => g + 1)}
              onRetry={() => { if (qr.status === 'finished') void save(form.getFieldsValue(true), qr) }} />}
            {kind === 'qq' && <details className="optionalCredentials"><summary>群聊设置</summary>
              <Form.Item name={['groupContext','visibility']} label="群消息可见范围"><Select options={[
                {value:'auto',label:'自动'}, {value:'mention_only',label:'仅 @ 机器人'}, {value:'mention_recent',label:'@ 和近期上下文'}, {value:'all',label:'全部群消息'}]} /></Form.Item>
              {visibility === 'all' && <Form.Item name={['groupContext','activation']} label="群聊回复条件"><Select options={[{value:'mention',label:'有人 @ 时'},{value:'always',label:'每条消息'}]} /></Form.Item>}
              {visibility !== 'mention_only' && <><Form.Item name={['groupContext','history_limit']} label="最近上下文条数"><InputNumber min={0} max={100} precision={0} /></Form.Item>
                <Form.Item name={['groupContext','clear_after_reply']} label="回复后清空群聊上下文" valuePropName="checked"><Switch /></Form.Item></>}
            </details>}
            <section className="displaySettings" aria-labelledby="channel-settings-title">
              <h2 id="channel-settings-title" className="displaySettingsTitle">通道设置</h2>
              <Form.Item name="responseMode" label="回复方式" extra={responseMode === 'stream'
                ? '可开启思考状态和工具调用提示。' : '处理结束后发送最终回复。'}>
                <Radio.Group className="responseModeChoice" name="channel-response-mode" aria-label="回复方式">
                  <Radio value="invoke">仅最终回复</Radio>
                  <Radio value="stream">处理提示和最终回复</Radio>
                </Radio.Group>
              </Form.Item>
              {responseMode === 'stream' && (
                <div className="progressSettings">
                  <div className="progressSetting">
                    <div><label htmlFor="showThinking">显示思考状态</label><p>模型开始思考时，在聊天中发送提示。</p></div>
                    <Form.Item name="showThinking" valuePropName="checked" noStyle><Switch id="showThinking" /></Form.Item>
                  </div>
                  <div className="progressSetting">
                    <div><label htmlFor="showToolHints">显示工具调用提示</label><p>在聊天中显示工具名称和调用状态。</p></div>
                    <Form.Item name="showToolHints" valuePropName="checked" noStyle><Switch id="showToolHints" /></Form.Item>
                  </div>
                </div>
              )}
              <Form.Item name="agentId" label="回复助手" extra="每个聊天会使用自己的 Moss 会话。">
                <Select className="channelSelect" options={[{ label: 'Moss 助手（默认）', value: '' }, ...(catalog?.assistants ?? [])]}
                  placeholder="Moss 助手（默认）" allowClear />
              </Form.Item>
              <Form.Item name="toolMode" label="可用工具" extra={toolMode === 'selected'
                ? '本渠道只可调用勾选的工具。' : '可用范围根据 Moss 和所选回复助手的设置更新。'}>
                <Select className="channelSelect" options={[
                  { label: '使用 Moss 默认工具', value: 'default' },
                  { label: '仅使用所选工具', value: 'selected' },
                ]} />
              </Form.Item>
              {catalogError ? (
                <div className="toolCatalogStatus" role="status">
                  {catalogError} <Button size="small" onClick={() => void loadCatalog()}>重试</Button>
                </div>
              ) : !catalog ? <Spin size="small" /> : toolMode === 'selected' ? (
                <>
                  <Form.Item name="allowedTools" noStyle>
                    <ToolList tools={availableTools} />
                  </Form.Item>
                  {invalidToolSelection && <p className="toolValidation" role="status">
                    {toolIds?.length ? '请取消勾选不可用的工具。' : '请至少选择一个可用工具。'}
                  </p>}
                </>
              ) : (
                <details className="defaultToolList">
                  <summary>查看可用工具 <span>{availableTools.length} 项</span></summary>
                  <ToolList tools={availableTools} />
                </details>
              )}
            </section>
            {(manual || status.configured) && (
              <div className="channelFormActions">
                <Button type="primary" htmlType="submit" loading={busy} disabled={invalidToolSelection}>保存设置</Button>
              </div>
            )}
          </>
        )}
      </Form>
    </main>
  )
}

export function renderChannel(kind: Kind) {
  createRoot(document.getElementById('root')!).render(
  <ConfigProvider locale={zhCN} prefixCls="mosswork" theme={{
    algorithm: theme.darkAlgorithm,
    token: {
      borderRadius: 8,
      fontFamily: 'var(--fn-font-family)',
      fontSize: 14,
      lineHeight: 1.5,
      colorPrimary: '#f97316',
      colorBgBase: 'var(--fn-bg-primary)',
      colorBgContainer: 'var(--fn-bg-container)',
      colorBgElevated: 'var(--fn-bg-elevated)',
      colorBgLayout: 'var(--fn-bg-layout)',
      colorBorder: 'rgba(255,255,255,0.08)',
      colorBorderSecondary: 'rgba(255,255,255,0.05)',
      colorText: 'var(--fn-text-primary)',
      colorTextSecondary: 'var(--fn-text-secondary)',
      colorTextTertiary: 'var(--fn-text-tertiary)',
      colorFillSecondary: 'rgba(255,255,255,0.04)',
      colorFillTertiary: 'rgba(255,255,255,0.03)',
    },
    components: {
      Alert: {
        colorTextHeading: 'var(--fn-text-primary)',
        colorSuccess: 'var(--fn-color-success)',
        colorSuccessBg: 'var(--fn-bg-success-light)',
        colorSuccessBorder: 'var(--fn-color-success-border)',
        colorWarning: 'var(--fn-color-warning)',
        colorWarningBg: 'var(--fn-bg-warning-light)',
        colorWarningBorder: 'var(--fn-color-warning-border)',
        colorError: 'var(--fn-color-danger)',
        colorErrorBg: 'var(--fn-bg-danger-light)',
        colorErrorBorder: 'var(--fn-color-danger-border)',
      },
      Segmented: {
        trackBg: 'var(--fn-bg-primary)',
        itemSelectedBg: 'var(--fn-color-brand-bg)',
        itemSelectedColor: 'var(--fn-color-brand-soft)',
        itemColor: 'var(--fn-text-secondary)',
      },
      Radio: { radioSize: 20, dotSize: 10 },
    },
  }}><App kind={kind} /></ConfigProvider>,
)
}
