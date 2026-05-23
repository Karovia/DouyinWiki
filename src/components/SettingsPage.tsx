import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Star,
  Eye,
  Video,
  FileJson,
  Type,
  X,
  AlertCircle,
} from 'lucide-react';
import { settingsApi, type ProviderItem } from '../trpc';

const WORKSPACE_ID = 'ws_default';

const CAPABILITY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  text: { label: '文本', icon: <Type size={12} /> },
  image: { label: '图片', icon: <Eye size={12} /> },
  video: { label: '视频', icon: <Video size={12} /> },
  json: { label: 'JSON', icon: <FileJson size={12} /> },
};

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

interface ProviderFormData {
  name: string;
  baseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
  videoModel: string;
  capabilities: string[];
  isDefault: boolean;
  isEnabled: boolean;
}

const emptyForm: ProviderFormData = {
  name: '',
  baseUrl: '',
  apiKey: '',
  textModel: '',
  visionModel: '',
  videoModel: '',
  capabilities: ['text'],
  isDefault: false,
  isEnabled: true,
};

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderItem | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>(emptyForm);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; latencyMs?: number; error?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await settingsApi.listProviders({ workspaceId: WORKSPACE_ID });
      setProviders(result.items);
    } catch (err) {
      console.error('Failed to load providers:', err);
      showToast('error', '加载模型服务列表失败');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const openCreateForm = () => {
    setEditingProvider(null);
    setFormData(emptyForm);
    setShowForm(true);
    setTestResult(null);
  };

  const openEditForm = (provider: ProviderItem) => {
    setEditingProvider(provider);
    setFormData({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      textModel: provider.textModel,
      visionModel: provider.visionModel ?? '',
      videoModel: provider.videoModel ?? '',
      capabilities: [...provider.capabilities],
      isDefault: provider.isDefault,
      isEnabled: provider.isEnabled,
    });
    setShowForm(true);
    setTestResult(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingProvider(null);
    setFormData(emptyForm);
    setTestResult(null);
  };

  const handleCapabilityToggle = (cap: string) => {
    setFormData(prev => {
      const has = prev.capabilities.includes(cap);
      const next = has ? prev.capabilities.filter(c => c !== cap) : [...prev.capabilities, cap];
      if (next.length === 0) return prev;
      return { ...prev, capabilities: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.baseUrl.trim() || !formData.textModel.trim()) {
      showToast('error', '请填写必填项：服务名称、Base URL、文本模型名');
      return;
    }

    setSubmitting(true);
    try {
      if (editingProvider) {
        const input: Record<string, unknown> = {
          id: editingProvider.id,
          workspaceId: WORKSPACE_ID,
          name: formData.name.trim(),
          baseUrl: formData.baseUrl.trim(),
          textModel: formData.textModel.trim(),
          capabilities: formData.capabilities,
          isDefault: formData.isDefault,
          isEnabled: formData.isEnabled,
        };
        if (formData.apiKey.trim()) {
          input.apiKey = formData.apiKey.trim();
        }
        if (formData.visionModel.trim()) {
          input.visionModel = formData.visionModel.trim();
        }
        if (formData.videoModel.trim()) {
          input.videoModel = formData.videoModel.trim();
        }
        await settingsApi.updateProvider(input as unknown as Parameters<typeof settingsApi.updateProvider>[0]);
        showToast('success', '模型服务已更新');
      } else {
        await settingsApi.createProvider({
          workspaceId: WORKSPACE_ID,
          name: formData.name.trim(),
          baseUrl: formData.baseUrl.trim(),
          apiKey: formData.apiKey.trim(),
          textModel: formData.textModel.trim(),
          visionModel: formData.visionModel.trim() || undefined,
          videoModel: formData.videoModel.trim() || undefined,
          capabilities: formData.capabilities,
          isDefault: formData.isDefault,
          isEnabled: formData.isEnabled,
        });
        showToast('success', '模型服务已创建');
      }
      closeForm();
      await loadProviders();
    } catch (err) {
      console.error('Failed to save provider:', err);
      showToast('error', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (provider: ProviderItem) => {
    const isDefault = provider.isDefault;
    const confirmMsg = isDefault
      ? `「${provider.name}」是当前默认模型服务，删除后将由系统自动指定新的默认服务。确定要删除吗？`
      : `确定要删除「${provider.name}」吗？此操作不可恢复。`;
    if (!window.confirm(confirmMsg)) return;
    setDeletingId(provider.id);
    try {
      await settingsApi.deleteProvider({ id: provider.id, workspaceId: WORKSPACE_ID });
      showToast('success', isDefault ? '模型服务已删除（请检查新的默认服务设置）' : '模型服务已删除');
      await loadProviders();
    } catch (err) {
      console.error('Failed to delete provider:', err);
      showToast('error', err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (provider: ProviderItem) => {
    if (provider.isDefault) return;
    setSettingDefaultId(provider.id);
    try {
      await settingsApi.setDefaultProvider({ id: provider.id, workspaceId: WORKSPACE_ID });
      showToast('success', `「${provider.name}」已设为默认`);
      await loadProviders();
    } catch (err) {
      console.error('Failed to set default provider:', err);
      showToast('error', err instanceof Error ? err.message : '设置默认失败');
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleTest = async (provider: ProviderItem) => {
    setTestingId(provider.id);
    setTestResult(null);
    try {
      const result = await settingsApi.testProvider({ id: provider.id, workspaceId: WORKSPACE_ID });
      setTestResult({ id: provider.id, ...result });
      if (result.success) {
        showToast('success', `连接成功，耗时 ${result.latencyMs ?? '--'}ms`);
      } else {
        showToast('error', result.error || '连接失败');
      }
    } catch (err) {
      console.error('Failed to test provider:', err);
      const msg = err instanceof Error ? err.message : '连接测试失败';
      setTestResult({ id: provider.id, success: false, error: msg });
      showToast('error', msg);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <motion.div
      key="settings-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6 md:space-y-8"
    >
      {/* Toast 提示 */}
      <div className="fixed top-20 right-4 z-[100] space-y-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-[14px] font-medium ${
                toast.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Settings size={24} className="text-[#2C2C2C]" />
          <h2 className="text-[24px] sm:text-[32px] md:text-[48px] font-bold text-text-primary">
            设置
          </h2>
        </div>
        <button
          onClick={openCreateForm}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2C2C2C] text-white rounded-xl text-[14px] font-medium hover:bg-[#1A1A1A] transition-colors"
        >
          <Plus size={16} />
          新增模型服务
        </button>
      </div>

      {/* 模型服务列表 */}
      <div className="space-y-4">
        <h3 className="text-[14px] font-bold text-text-secondary uppercase tracking-[0.1em]">
          模型服务
        </h3>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 size={24} className="animate-spin mx-auto text-text-secondary" />
            <p className="text-text-secondary text-[14px] mt-3">加载中...</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border-subtle rounded-2xl">
            <AlertCircle size={32} className="mx-auto text-text-secondary/50 mb-3" />
            <p className="text-[15px] text-text-secondary font-medium">尚未配置模型服务</p>
            <p className="text-[13px] text-text-secondary/60 mt-1">请点击上方按钮添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map(provider => (
              <motion.div
                key={provider.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`card p-5 transition-all ${
                  provider.isDefault ? 'border-amber-300 ring-1 ring-amber-100' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[16px] font-bold text-text-primary truncate">
                        {provider.name}
                      </h4>
                      {provider.isDefault && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[11px] font-medium border border-amber-200">
                          <Star size={10} className="fill-amber-500 text-amber-500" />
                          默认
                        </span>
                      )}
                      {!provider.isEnabled && (
                        <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[11px] font-medium border border-gray-200">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text-secondary truncate">{provider.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEditForm(provider)}
                      className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-text-secondary hover:text-text-primary transition-colors"
                      title="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(provider)}
                      disabled={deletingId === provider.id}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-text-secondary hover:text-red-500 transition-colors disabled:opacity-50"
                      title="删除"
                    >
                      {deletingId === provider.id ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {provider.capabilities.map(cap => {
                      const info = CAPABILITY_LABELS[cap];
                      return (
                        <span
                          key={cap}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F5F5F5] text-[#8C8C8C] rounded-md text-[11px] font-medium"
                        >
                          {info?.icon}
                          {info?.label ?? cap}
                        </span>
                      );
                    })}
                  </div>

                  <div className="text-[12px] text-text-secondary space-y-0.5">
                    <p>文本模型: <span className="text-text-primary font-medium">{provider.textModel}</span></p>
                    {provider.visionModel && (
                      <p>视觉模型: <span className="text-text-primary font-medium">{provider.visionModel}</span></p>
                    )}
                    {provider.videoModel && (
                      <p>视频模型: <span className="text-text-primary font-medium">{provider.videoModel}</span></p>
                    )}
                    <p>
                      API Key:
                      <span className={provider.hasApiKey ? 'text-green-600 font-medium ml-1' : 'text-red-500 font-medium ml-1'}>
                        {provider.hasApiKey ? '已配置' : '未配置'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => handleTest(provider)}
                    disabled={testingId === provider.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F5F5F5] text-[#2C2C2C] rounded-lg text-[12px] font-medium hover:bg-[#EAEAEA] transition-colors disabled:opacity-50"
                  >
                    {testingId === provider.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Zap size={13} />
                    )}
                    测试连接
                  </button>
                  {!provider.isDefault && (
                    <button
                      onClick={() => handleSetDefault(provider)}
                      disabled={settingDefaultId === provider.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[12px] font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      {settingDefaultId === provider.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Star size={13} />
                      )}
                      设为默认
                    </button>
                  )}
                </div>

                {testResult?.id === provider.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3"
                  >
                    <div
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium ${
                        testResult.success
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      {testResult.success
                        ? `连接成功${testResult.latencyMs !== undefined ? `，耗时 ${testResult.latencyMs}ms` : ''}`
                        : testResult.error || '连接失败'}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 表单弹窗 */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={closeForm}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-[560px] w-full max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-[#EAEAEA] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                <h3 className="text-[18px] font-bold text-text-primary">
                  {editingProvider ? '编辑模型服务' : '新增模型服务'}
                </h3>
                <button
                  onClick={closeForm}
                  className="w-8 h-8 rounded-full hover:bg-[#F5F5F5] flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                {/* 服务名称 */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    服务名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：OpenAI、Ollama"
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                {/* Base URL */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    Base URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.baseUrl}
                    onChange={e => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="http://localhost:11434 或 https://api.openai.com"
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    API Key
                    {editingProvider && (
                      <span className="text-text-secondary font-normal ml-1">（留空表示不修改）</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={e => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={editingProvider ? '已配置' : 'sk-...'}
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                {/* 模型名称 */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    文本模型名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.textModel}
                    onChange={e => setFormData(prev => ({ ...prev, textModel: e.target.value }))}
                    placeholder="例如：gpt-4o、llama3.1"
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    视觉模型名 <span className="text-text-secondary font-normal">（可选）</span>
                  </label>
                  <input
                    type="text"
                    value={formData.visionModel}
                    onChange={e => setFormData(prev => ({ ...prev, visionModel: e.target.value }))}
                    placeholder="例如：gpt-4o-vision"
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-text-primary">
                    视频模型名 <span className="text-text-secondary font-normal">（可选）</span>
                  </label>
                  <input
                    type="text"
                    value={formData.videoModel}
                    onChange={e => setFormData(prev => ({ ...prev, videoModel: e.target.value }))}
                    placeholder="例如：sora"
                    className="w-full px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                  />
                </div>

                {/* 能力开关 */}
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-text-primary">能力</label>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(CAPABILITY_LABELS).map(([key, info]) => (
                      <label
                        key={key}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors select-none ${
                          formData.capabilities.includes(key)
                            ? 'bg-[#2C2C2C] text-white border-[#2C2C2C]'
                            : 'bg-white text-text-secondary border-border-subtle hover:border-[#8C8C8C]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.capabilities.includes(key)}
                          onChange={() => handleCapabilityToggle(key)}
                          className="sr-only"
                        />
                        {info.icon}
                        <span className="text-[13px] font-medium">{info.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 是否设为默认 */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                    className="w-4 h-4 rounded border-border-subtle text-[#2C2C2C] focus:ring-accent/20"
                  />
                  <span className="text-[14px] text-text-primary">设为默认模型服务</span>
                </label>

                {/* 是否启用 */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.isEnabled}
                    onChange={e => setFormData(prev => ({ ...prev, isEnabled: e.target.checked }))}
                    className="w-4 h-4 rounded border-border-subtle text-[#2C2C2C] focus:ring-accent/20"
                  />
                  <span className="text-[14px] text-text-primary">启用此服务</span>
                </label>

                {/* 提交按钮 */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="px-5 py-2.5 rounded-xl text-[14px] font-medium text-text-secondary hover:bg-[#F5F5F5] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 bg-[#2C2C2C] text-white rounded-xl text-[14px] font-medium hover:bg-[#1A1A1A] transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {editingProvider ? '保存修改' : '创建'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
