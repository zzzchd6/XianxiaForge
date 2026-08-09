import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Plug, Database, CheckCircle2, XCircle, Feather, GitBranch, BarChart3 } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input,
  Spinner, useToast, Badge, Switch,
} from '../components/ui'
import { settingsApi, usageApi } from '../lib/api'

/** 任务角色定义（与后端 AGENT_ROLES 一致，开源借鉴 PRD v1.1 M3） */
const AGENT_ROLES: { role: string; label: string; desc: string }[] = [
  { role: 'writer', label: '写作 Writer', desc: '正文初稿，质量关键步，可配强模型' },
  { role: 'auditor', label: '审计 Auditor', desc: '30维质量审计，可配低成本模型' },
  { role: 'reviser', label: '修订 Reviser', desc: '回炉修订/精修压缩' },
  { role: 'extractor', label: '状态抽取 Extractor', desc: '后验人物状态快照抽取' },
  { role: 'branch', label: '分支生成 Branch', desc: '后验剧情分支生成' },
  { role: 'quote', label: '金句提取 Quote', desc: '后验金句提取' },
]

export default function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // LLM配置表单
  const [llmConfig, setLlmConfig] = useState({
    baseUrl: '',
    apiKey: '',
    model: '',
    maxTokens: 4096,
    temperature: 0.8,
  })

  // 默认生成参数
  const [genDefaults, setGenDefaults] = useState({
    defaultTargetWordCount: 3000,
    defaultConflictLevel: 'medium',
    branchEnabled: true,
    branchOptionCount: 3,
  })

  // 连接测试结果
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // 按任务角色模型分流（开源借鉴 PRD v1.1 M3）：空=回退全局模型
  const [agentModels, setAgentModels] = useState<Record<string, string>>({})

  // 获取当前设置
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  // 获取数据库状态
  const { data: dbStatus, refetch: refetchDb } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => settingsApi.dbStatus(),
  })

  // 获取文风预设
  const { data: stylePresets } = useQuery({
    queryKey: ['style-presets'],
    queryFn: () => settingsApi.getStylePresets(),
  })

  // 设置加载后填充表单
  useEffect(() => {
    if (settings) {
      // apiKey 后端返回掩码（***已配置***/未配置），不回显到可编辑框，避免保存时回写覆盖真实 key
      const rawKey = settings.llm?.apiKey || ''
      const isMask = rawKey === '***已配置***' || rawKey === '未配置'
      setLlmConfig({
        baseUrl: settings.llm?.baseUrl || '',
        apiKey: isMask ? '' : rawKey,
        model: settings.llm?.model || '',
        maxTokens: settings.llm?.maxTokens || 4096,
        temperature: settings.llm?.temperature || 0.8,
      })
      setGenDefaults({
        defaultTargetWordCount: settings.generation?.defaultTargetWordCount || 3000,
        defaultConflictLevel: settings.generation?.defaultConflictLevel || 'medium',
        branchEnabled: settings.generation?.branchEnabled !== false,
        branchOptionCount: settings.generation?.branchOptionCount || 3,
      })
      setAgentModels(Object.fromEntries(
        AGENT_ROLES.map((r) => [r.role, settings.agentModels?.[r.role] || ''])
      ))
    }
  }, [settings])

  // 保存设置
  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update({
      llm: {
        ...llmConfig,
        baseUrl: llmConfig.baseUrl.trim(),
        // 数字输入框清空会得到 0/NaN，回退到合法值避免后端校验拒绝
        maxTokens: Number.isFinite(llmConfig.maxTokens) && llmConfig.maxTokens >= 100 ? llmConfig.maxTokens : 4096,
      },
      generation: genDefaults,
      agentModels,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast('设置已保存', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 测试LLM连接
  const testMutation = useMutation({
    mutationFn: () => settingsApi.testLlm({
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
    }),
    onSuccess: (data) => {
      setTestResult({ success: true, message: data.message || '连接成功' })
      toast('LLM连接测试成功', 'success')
    },
    onError: (err: any) => {
      setTestResult({ success: false, message: err.message || '连接失败' })
      toast('LLM连接测试失败', 'error')
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">设置</h1>

      {/* LLM配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-indigo-400" />
            LLM 配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={llmConfig.baseUrl}
            onChange={(e) => setLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
          />
          <Input
            label="API Key"
            type="password"
            placeholder="sk-..."
            value={llmConfig.apiKey}
            onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
          />
          <Input
            label="模型"
            placeholder="gpt-4o / claude-3.5-sonnet"
            value={llmConfig.model}
            onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Max Tokens"
              type="number"
              value={llmConfig.maxTokens}
              onChange={(e) => setLlmConfig({ ...llmConfig, maxTokens: Number(e.target.value) })}
            />
            <div className="space-y-1.5">
              <label htmlFor="settings-temperature" className="block text-sm font-medium text-gray-300">
                Temperature: {llmConfig.temperature.toFixed(1)}
              </label>
              <input
                id="settings-temperature"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={llmConfig.temperature}
                onChange={(e) => setLlmConfig({ ...llmConfig, temperature: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>

          {/* 测试连接 */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              loading={testMutation.isPending}
            >
              测试连接
            </Button>
            {testResult && (
              <span aria-live="polite" className={`flex items-center gap-1 text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {testResult.success
                  ? <CheckCircle2 className="h-4 w-4" />
                  : <XCircle className="h-4 w-4" />
                }
                {testResult.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 按任务角色模型分流（开源借鉴 PRD v1.1 M3 / US-09） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-400" />
            按任务角色模型分流
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            为不同任务角色指定专属模型以降低长链路成本；留空则回退上方全局模型。用户生成时显式指定的模型优先于此处配置。
          </p>
          {AGENT_ROLES.map((r) => (
            <Input
              key={r.role}
              label={`${r.label}（${r.desc}）`}
              placeholder={`留空=用全局模型（${llmConfig.model || '未配置'}）`}
              value={agentModels[r.role] || ''}
              onChange={(e) => setAgentModels({ ...agentModels, [r.role]: e.target.value })}
            />
          ))}
        </CardContent>
      </Card>

      {/* 数据库状态 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-indigo-400" />
            数据库状态
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-800 p-3">
            <span className="text-sm text-gray-300">诛仙库（世界观数据）</span>
            <Badge variant={dbStatus?.zhuxian?.connected ? 'success' : 'destructive'}>
              {dbStatus?.zhuxian?.connected ? '已连接' : '未连接'}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-800 p-3">
            <span className="text-sm text-gray-300">创作库（项目数据）</span>
            <Badge variant={dbStatus?.creative?.connected ? 'success' : 'destructive'}>
              {dbStatus?.creative?.connected ? '已连接' : '未连接'}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetchDb()}>
            刷新状态
          </Button>
        </CardContent>
      </Card>

      {/* 默认生成参数 */}
      <Card>
        <CardHeader>
          <CardTitle>默认生成参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="默认目标字数"
            type="number"
            value={genDefaults.defaultTargetWordCount}
            onChange={(e) => setGenDefaults({ ...genDefaults, defaultTargetWordCount: Number(e.target.value) })}
            min={500}
            max={10000}
            step={500}
          />
          <div className="space-y-1.5">
            <label htmlFor="settings-conflict-level" className="block text-sm font-medium text-gray-300">默认冲突等级</label>
            <select
              id="settings-conflict-level"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              value={genDefaults.defaultConflictLevel}
              onChange={(e) => setGenDefaults({ ...genDefaults, defaultConflictLevel: e.target.value })}
            >
              <option value="low">低 - 日常/过渡</option>
              <option value="medium">中 - 推进/发展</option>
              <option value="high">高 - 对抗/高潮</option>
              <option value="climax">极高 - 决战/转折</option>
            </select>
          </div>

          {/* 剧情分支 */}
          <div className="border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-300">剧情分支系统</label>
                <p className="mt-0.5 text-xs text-gray-500">
                  章节生成后自动提供 2-4 个下一章走向选项，供选择后衍生下一章计划
                </p>
              </div>
              <Switch
                checked={genDefaults.branchEnabled}
                onChange={(v) => setGenDefaults({ ...genDefaults, branchEnabled: v })}
              />
            </div>
            {genDefaults.branchEnabled && (
              <div className="mt-3 space-y-1.5">
                <label htmlFor="settings-branch-count" className="block text-sm font-medium text-gray-300">分支选项数量</label>
                <select
                  id="settings-branch-count"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={genDefaults.branchOptionCount}
                  onChange={(e) => setGenDefaults({ ...genDefaults, branchOptionCount: Number(e.target.value) })}
                >
                  <option value={2}>2 个选项</option>
                  <option value={3}>3 个选项</option>
                  <option value={4}>4 个选项</option>
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 文风预设 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Feather className="h-4 w-4 text-indigo-400" />
            文风预设
            <a href="/material-kb" className="ml-auto text-xs text-gold-400 hover:text-gold-300 underline">
              管理全部 →
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-gray-500">
            内置文风预设用于生成时的风格引导，可在章节计划中指定使用。
          </p>
          {!stylePresets?.length ? (
            <p className="text-sm text-gray-600">暂无预设</p>
          ) : (
            stylePresets.map((p: any) => (
              <div key={p.id} className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">{p.name}</span>
                  <Badge variant="default" className="text-[10px]">{p.id}</Badge>
                </div>
                <p className="mt-1 text-xs text-gray-400">{p.description}</p>
                {p.overrides?.descriptionRatio && (
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {Object.entries(p.overrides.descriptionRatio).map(([k, v]: [string, any]) => (
                      <div key={k}>
                        <div className="mb-0.5 flex justify-between text-[10px] text-gray-500">
                          <span>{{ scene: '场景', action: '动作', dialogue: '对话', psychology: '心理' }[k] || k}</span>
                          <span>{v}%</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-700">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${v}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {p.overrides?.matchedSceneFlavor?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.overrides.matchedSceneFlavor.map((f: string, i: number) => (
                      <span key={i} className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400 italic">
                        「{f}」
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          保存设置
        </Button>
      </div>

      {/* 用量统计面板（开源借鉴 PRD v1.1 M3 / US-10） */}
      <UsagePanel />
    </div>
  )
}

/** 用量统计面板：近 30 天 token 趋势 + 按角色拆分 + 成本估算 */
function UsagePanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['usage-summary'],
    queryFn: () => usageApi.summary({ days: 30 }),
  })

  const totals = data?.totals
  const byDay: any[] = data?.byDay || []
  const byRole: any[] = data?.byRole || []
  const maxDayTokens = Math.max(1, ...byDay.map((d) => d.tokens))
  const maxRoleTotal = Math.max(1, ...byRole.map((r) => r.total))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-indigo-400" />
          用量统计（近 30 天）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : !totals ? (
          <p className="text-sm text-gray-600">暂无用量数据</p>
        ) : (
          <>
            {/* 总览 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: '任务数', value: String(totals.taskCount) },
                { label: '总 token', value: totals.tokensUsed.toLocaleString() },
                { label: '输入/输出', value: `${totals.checkpointInput.toLocaleString()} / ${totals.checkpointOutput.toLocaleString()}` },
                { label: '估算成本（元）', value: `≈ ${totals.estimatedCost}` },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-gray-800 p-3">
                  <p className="text-[11px] text-gray-500">{s.label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-200">{s.value}</p>
                </div>
              ))}
            </div>

            {/* 按日趋势 */}
            {byDay.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-400">按日 token 趋势</p>
                <div className="space-y-1">
                  {byDay.map((d) => (
                    <div key={d.date} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 shrink-0 text-gray-500">{d.date.slice(5)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(d.tokens / maxDayTokens) * 100}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right text-gray-400">{d.tokens.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 按角色拆分 */}
            {byRole.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-400">按任务角色拆分（checkpoint 口径）</p>
                <div className="space-y-1">
                  {byRole.map((r) => (
                    <div key={r.role} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate text-gray-400">{r.role}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${(r.total / maxRoleTotal) * 100}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-gray-400">
                        {r.input.toLocaleString()}↓ {r.output.toLocaleString()}↑
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-gray-600">成本为默认单价估算（输入 {totals.pricePerK?.input} 元/1k、输出 {totals.pricePerK?.output} 元/1k），仅供支出参考</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
