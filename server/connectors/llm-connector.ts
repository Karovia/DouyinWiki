/**
 * LLM 连接器
 * 使用项目自己的 OpenAI-compatible LLM Client
 * 支持多模态：封面图片 + 视频直接理解 + 帧提取降级
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { uploadBuffer } from './storage-connector';
import { invokeDefaultLlm } from './llm/llm-service';
import type { LlmMessage, LlmContentPart } from './llm/types';

const execFileAsync = promisify(execFile);

// 默认工作区 ID（当前代码未从调用方传递 workspaceId，后续可扩展）
const DEFAULT_WORKSPACE_ID = 'ws_default';

// ─── Prompt 模板 ───

const SUMMARY_PROMPT = `你是一个专业的视频内容分析师。请根据提供的视频信息和封面图片，生成一段简洁的中文摘要。

要求：
1. 摘要长度 150-300 字
2. 如果有封面图片，请结合图片中的视觉信息进行描述
3. 突出视频的核心主题和关键信息
4. 语言简洁、信息密度高
5. 如果信息不足，请基于已有信息和图片推断视频可能的内容方向

请直接输出摘要文本，不要添加前缀或格式标记。`;

const QA_SUMMARY_SYSTEM_PROMPT = `你是一个专业的视频内容助手。你可以根据视频的 AI 摘要、标签、描述和封面图片来回答用户关于视频内容的问题。

要求：
1. 回答要准确、具体，基于已知信息作答
2. 回答使用中文，语言简洁明了
3. 如果你认为当前提供的摘要、标签和描述信息不足以完整回答用户的问题（比如用户问到了视频中的具体画面、对话、动作细节等），请在回答的最开头输出标记 [INSUFFICIENT]，然后再给出基于已有信息的初步回答
4. 如果已有信息足以回答问题，直接回答即可，不要输出任何标记`;

const QA_VIDEO_SYSTEM_PROMPT = `你是一个专业的视频内容分析师。用户提出了一个关于视频的具体问题，之前的摘要信息不足以完整回答。请你直接观看视频，根据视频中的实际内容来详细回答用户的问题。

要求：
1. 仔细观看视频内容，基于你看到的画面、文字、场景来回答
2. 回答要具体、详细，引用视频中的实际内容
3. 使用中文回答，语言简洁明了
4. 如果视频中确实没有相关信息，请诚实说明`;

const QA_FRAMES_SYSTEM_PROMPT = `你是一个专业的视频内容分析师。用户提出了一个关于视频的具体问题，之前的摘要信息不足以完整回答。以下是视频中的关键帧截图（按时间顺序排列），请根据这些截图来详细回答用户的问题。

要求：
1. 仔细分析每张截图中的画面内容，包括人物、场景、文字、动作等
2. 回答要具体、详细，引用截图中的实际内容
3. 使用中文回答，语言简洁明了
4. 如果截图中没有相关信息，请诚实说明`;

const TAG_PROMPT = `你是一个专业的内容标签生成器。请根据视频信息生成 3-5 个相关标签。

要求：
1. 每个标签 2-6 个字
2. 标签应覆盖主题、领域、内容类型
3. 只输出标签，用逗号分隔，不要添加序号或其他格式

示例输出：科技,AI,编程,教程,前端`;

const DEEP_RESEARCH_PROMPT = `你是一位专业领域的深度研究分析师。请基于用户提供的视频信息，围绕用户指定的研究主题，撰写一份深度研究报告。

请用 Markdown 格式输出，要求：
1. 报告标题用 # 一级标题
2. 包含以下章节（根据实际情况调整）：
   - 研究背景与概述
   - 核心观点分析
   - 关键数据与事实
   - 深度洞察与思考
   - 相关延伸与建议
3. 内容要有深度、有逻辑、有洞察，不是简单的信息罗列
4. 语言专业但通俗易懂
5. 适当使用列表、表格、引用等 Markdown 语法增强可读性`;

// ─── 生成摘要 ───

export async function generateSummary(
  videoInfo: { title: string; authorName: string | null; description: string | null; coverUrl?: string; pageText?: string },
  _customHeaders?: Record<string, string>,
): Promise<string> {
  const userContent: LlmContentPart[] = [];

  const textParts = [
    `视频标题：${videoInfo.title}`,
    videoInfo.authorName ? `作者：${videoInfo.authorName}` : '',
    videoInfo.description ? `描述：${videoInfo.description}` : '',
    videoInfo.pageText ? `页面文本：${videoInfo.pageText.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n');

  userContent.push({ type: 'text', text: textParts });

  if (videoInfo.coverUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: videoInfo.coverUrl, detail: 'high' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'vision',
      temperature: 0.5,
    });
    return result.content.trim();
  } catch (error) {
    console.error('LLM summary generation failed:', error);
    throw error;
  }
}

// ─── 生成标签 ───

export async function generateTags(
  videoInfo: { title: string; authorName: string | null; description: string | null; aiSummary?: string },
  _customHeaders?: Record<string, string>,
): Promise<string[]> {
  const userContent = [
    `标题：${videoInfo.title}`,
    videoInfo.authorName ? `作者：${videoInfo.authorName}` : '',
    videoInfo.description ? `描述：${videoInfo.description}` : '',
    videoInfo.aiSummary ? `摘要：${videoInfo.aiSummary}` : '',
  ].filter(Boolean).join('\n');

  const messages: LlmMessage[] = [
    { role: 'system', content: TAG_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'text',
      temperature: 0.3,
    });
    return result.content
      .split(/[,，、\n]/)
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0 && t.length <= 10)
      .slice(0, 5);
  } catch (error) {
    console.error('LLM tag generation failed:', error);
    return [];
  }
}

// ─── 基于摘要的 Q&A（第一层：快速回答） ───

export interface SummaryQAResult {
  answer: string;
  needsVideoAnalysis: boolean;
}

export async function askWithSummary(
  params: {
    question: string;
    videoTitle: string;
    aiSummary: string;
    tags: string[];
    description?: string;
    coverUrl?: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<SummaryQAResult> {
  const contextParts = [
    `视频标题：${params.videoTitle}`,
    `AI 摘要：${params.aiSummary}`,
    params.tags.length > 0 ? `标签：${params.tags.join('、')}` : '',
    params.description ? `原始描述：${params.description}` : '',
  ].filter(Boolean).join('\n');

  const userContent: LlmContentPart[] = [];

  userContent.push({
    type: 'text',
    text: `视频上下文信息：\n${contextParts}\n\n用户提问：${params.question}`,
  });

  if (params.coverUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: params.coverUrl, detail: 'low' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: QA_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'vision',
      temperature: 0.7,
    });
    const rawAnswer = result.content;
    const trimmed = rawAnswer.trim();
    const needsVideoAnalysis = trimmed.startsWith('[INSUFFICIENT]');
    const answer = needsVideoAnalysis
      ? trimmed.replace(/^\[INSUFFICIENT\]\s*/, '').trim()
      : trimmed;

    return { answer, needsVideoAnalysis };
  } catch (error) {
    console.error('[LLM] Summary QA failed:', error);
    throw error;
  }
}

// ─── ffmpeg 提取视频关键帧 → 上传 S3 → 返回图片 URL 列表 ───

// LLM video_url 接口有大小限制（约50MiB），超限会返回 InvalidParameter 错误
// askWithVideo 会先尝试直接传 video_url，失败后自动降级为帧提取

async function extractKeyFrames(
  videoUrl: string,
  videoId: string,
  /** 每隔多少秒取一帧，默认 5 秒 */
  intervalSec: number = 5,
  /** 最多提取多少帧，默认 10 */
  maxFrames: number = 10,
): Promise<string[]> {
  const tmpDir = `/tmp/frames_${videoId}_${Date.now()}`;
  await mkdir(tmpDir, { recursive: true });

  try {
    // 用 ffmpeg 提取关键帧
    const framePattern = join(tmpDir, 'frame_%03d.jpg');
    await execFileAsync('ffmpeg', [
      '-i', videoUrl,
      '-vf', `fps=1/${intervalSec}`,
      '-q:v', '2',           // 高质量 JPEG
      '-frames:v', String(maxFrames),
      '-y',
      framePattern,
    ], { timeout: 120000 });

    // 读取提取的帧，上传到 S3
    const frameUrls: string[] = [];
    for (let i = 1; i <= maxFrames; i++) {
      const framePath = join(tmpDir, `frame_${String(i).padStart(3, '0')}.jpg`);
      try {
        const buffer = await readFile(framePath);
        const fileName = `frames/${videoId}_frame_${i}.jpg`;
        const key = await uploadBuffer(buffer, fileName, 'image/jpeg');
        // 生成签名 URL
        const { getSignedUrl } = await import('./storage-connector');
        const signedUrl = await getSignedUrl(key, 600);
        frameUrls.push(signedUrl);
      } catch {
        // 帧文件不存在，说明已到末尾
        break;
      }
    }

    console.log(`[LLM] Extracted ${frameUrls.length} key frames for video ${videoId}`);
    return frameUrls;
  } finally {
    // 清理临时文件
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ─── 基于视频深度分析的 Q&A（第二层） ───

export async function askWithVideo(
  params: {
    question: string;
    videoTitle: string;
    aiSummary: string;
    videoUrl: string;
    videoId: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<string> {
  // 方案 A：直接传视频 URL 给 LLM（最准确，但有大小限制）
  try {
    return await askWithVideoUrl(params);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    // 视频太大或格式不支持，降级为方案 B
    if (errMsg.includes('exceeds the limit') || errMsg.includes('InvalidParameter')) {
      console.log('[LLM] Video too large, falling back to key frames');
      return askWithKeyFrames(params);
    }
    // 其他错误（如网络、认证）直接抛出
    throw error;
  }
}

/** 方案 A：直接传视频 URL 给 LLM */
async function askWithVideoUrl(
  params: { question: string; videoTitle: string; aiSummary: string; videoUrl: string },
): Promise<string> {
  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: [
        `视频标题：${params.videoTitle}`,
        `AI 摘要（参考）：${params.aiSummary}`,
        '',
        `用户提问：${params.question}`,
        '',
        '请观看视频，根据视频实际内容详细回答用户的问题。',
      ].join('\n'),
    },
    {
      type: 'video_url',
      video_url: { url: params.videoUrl, fps: 1 },
    },
  ];

  const messages: LlmMessage[] = [
    { role: 'system', content: QA_VIDEO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
    capability: 'video',
    temperature: 0.7,
  });
  return result.content.trim();
}

export async function generateDeepResearch(params: {
  videoTitle: string;
  aiSummary: string;
  description?: string;
  topic: string;
}): Promise<string> {
  const userPrompt = [
    `视频标题：${params.videoTitle}`,
    `视频摘要：${params.aiSummary || '无'}`,
    `视频描述：${params.description || '无'}`,
    `用户研究主题：${params.topic}`,
    '',
    '请围绕用户指定的研究主题，基于视频内容，撰写一份深度研究报告。',
  ].join('\n');

  const messages: LlmMessage[] = [
    { role: 'system', content: DEEP_RESEARCH_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
    capability: 'text',
    temperature: 0.7,
  });

  return result.content.trim();
}

// ─── 训练计划步骤生成 ───

export interface TrainingStep {
  step: number;
  title: string;
  description: string;
  /** 组数，如 3 */
  sets?: number;
  /** 次数，如 12 */
  reps?: number;
  /** 计时器时长（秒） */
  timerSeconds?: number;
  /** 计时器标签 */
  timerLabel?: string;
  /** 休息时长（秒） */
  restSeconds?: number;
  /** 休息标签 */
  restLabel?: string;
}

export interface TrainingPlan {
  workoutName: string;
  targetMuscle: string;
  duration: string;
  difficulty: string;
  warmup: string[];
  steps: TrainingStep[];
  cooldown: string[];
}

const TRAINING_PLAN_SCHEMA = `{
  "workoutName": "训练名称",
  "targetMuscle": "目标肌群",
  "duration": "预计时长",
  "difficulty": "beginner|intermediate|advanced",
  "warmup": ["热身动作1", "热身动作2"],
  "steps": [
    {
      "step": 1,
      "title": "动作名称",
      "description": "动作描述",
      "sets": 3,
      "reps": 12,
      "timerSeconds": 30,
      "timerLabel": "计时标签",
      "restSeconds": 60,
      "restLabel": "休息"
    }
  ],
  "cooldown": ["拉伸动作1", "拉伸动作2"]
}`;

// ─── 旅游攻略类型 ───

export interface PlanningScheduleItem {
  time: string;
  activity: string;
  note?: string;
}

export interface PlanningStep {
  day: number;
  title: string;
  description: string;
  schedule: PlanningScheduleItem[];
  tips?: string;
}

export interface TravelPlan {
  planName: string;
  destination: string;
  duration: string;
  budgetLevel: string;
  theme: string;
  overview: string;
  steps: PlanningStep[];
  tips: string[];
}

const TRAVEL_PLAN_SCHEMA = `{
  "planName": "攻略名称",
  "destination": "目的地",
  "duration": "行程天数",
  "budgetLevel": "预算等级",
  "theme": "旅行主题",
  "overview": "整体行程概览描述",
  "steps": [
    {
      "day": 1,
      "title": "第一天标题",
      "description": "当天行程描述",
      "schedule": [
        { "time": "09:00", "activity": "活动名称", "note": "备注说明" }
      ],
      "tips": "当天小贴士"
    }
  ],
  "tips": ["通用建议1", "通用建议2"]
}`;

// ─── 做菜教程步骤生成 ───

export interface CookingStep {
  step: number;
  title: string;
  description: string;
  /** 计时器时长（秒），null 表示无需计时 */
  timerSeconds: number | null;
  /** 计时器提示文字 */
  timerLabel: string | null;
}

export interface CookingRecipe {
  dishName: string;
  servings: string;
  ingredients: string[];
  steps: CookingStep[];
}

const TRAINING_PROMPT = `你是一个专业的健身训练视频分析师。用户会提供一段健身/运动/训练视频的信息（可能包含摘要、关键帧截图或视频），请将其转化为结构化的训练计划步骤卡片。

要求：
1. 提取训练名称、目标肌群、难度等级、总时长
2. 将视频中的动作拆解为结构化步骤，每个步骤包含：
   - 动作名称
   - 详细动作要领和注意事项
   - 推荐组数（如 "3组"）
   - 推荐次数（如 "12次" 或 "30秒"）
   - 是否需要计数器（如深蹲、俯卧撑等需要记次数的动作）
   - 是否需要计时器（如平板支撑、开合跳等需要计时的动作）
   - 休息时长（如有）
3. 对于计时动作，预估合理的时长（如平板支撑30秒、开合跳45秒等）
4. 对于计数动作，标注推荐的次数（如深蹲12次、俯卧撑10次等）
5. 休息步骤也需要标注时长
6. 严格只返回 JSON 格式数据，不要添加任何额外说明文字

请严格只返回 JSON，格式如下：
{
  "planName": "训练名称",
  "targetBodyPart": "目标肌群（如：全身/胸肌/腹肌/腿部等）",
  "difficulty": "难度（初级/中级/高级）",
  "totalDuration": "总时长（如：30分钟）",
  "steps": [
    {
      "step": 1,
      "title": "动作名称",
      "description": "详细动作要领和注意事项",
      "reps": "12次",
      "sets": "3组",
      "needsCounter": true,
      "needsTimer": false,
      "timerSeconds": null,
      "timerLabel": null,
      "restSeconds": 60,
      "restLabel": "组间休息"
    }
  ]
}`;

const COOKING_RECIPE_PROMPT = `你是一个专业的做菜教程分析师。用户会提供一段做菜视频的信息（可能包含摘要、关键帧截图或视频），请将其转化为结构化的菜谱步骤卡片。

要求：
1. 提取菜品名称、份量、所需食材列表
2. 将视频内容拆分为 4-10 个步骤，每步包含：
   - title: 简短标题（2-6字）
   - description: 详细操作说明（30-80字，具体到用量和手法）
   - timerSeconds: 如果此步骤需要等待（如煎炸、焖煮、腌制、发酵等），填入推荐秒数；无需等待则填 null
   - timerLabel: 计时提示文字（如"煎至两面金黄"、"焖煮入味"），无计时则为 null
3. 步骤顺序应与视频一致，计时时间应参考视频中的推荐
4. 食材用量尽量具体（如"盐 1小勺"、"生抽 2勺"）

请严格按以下 JSON 格式输出，不要添加任何其他文字：
{
  "dishName": "菜品名",
  "servings": "份量（如2人份）",
  "ingredients": ["食材1 用量", "食材2 用量"],
  "steps": [
    {
      "step": 1,
      "title": "步骤标题",
      "description": "详细操作说明",
      "timerSeconds": 180,
      "timerLabel": "计时提示"
    }
  ]
}`;

/** 基于摘要+关键帧生成菜谱步骤 */
export async function generateCookingRecipe(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    coverUrl?: string;
    /** 视频签名 URL（可选，用于深度分析） */
    videoUrl?: string;
    videoId?: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<CookingRecipe | null> {
  const userContent: LlmContentPart[] = [];

  const textParts = [
    `视频标题：${params.videoTitle}`,
    `AI 摘要：${params.aiSummary}`,
    params.description ? `描述：${params.description}` : '',
    '',
    '请将以上做菜视频内容转化为结构化菜谱步骤。',
  ].filter(Boolean).join('\n');

  userContent.push({ type: 'text', text: textParts });

  // 优先添加封面图
  if (params.coverUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: params.coverUrl, detail: 'high' },
    });
  }

  // 如果有视频 URL，直接传视频
  let useVideoUrl = false;
  if (params.videoUrl && params.videoId) {
    userContent.push({
      type: 'video_url',
      video_url: { url: params.videoUrl, fps: 1 },
    });
    useVideoUrl = true;
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: COOKING_RECIPE_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: useVideoUrl ? 'video' : 'vision',
      temperature: 0.3,
    });

    // 解析 JSON 响应
    const raw = result.content.trim();
    // 尝试从 markdown 代码块中提取 JSON
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // LLM 可能拒绝生成（非做菜视频）
      console.warn('[LLM] Cooking recipe (video_url) - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    const recipe: CookingRecipe = JSON.parse(jsonMatch[0]);
    return recipe;
  } catch (error: unknown) {
    // 如果视频太大导致失败，降级为帧提取
    const errMsg = error instanceof Error ? error.message : String(error);
    if (useVideoUrl && (errMsg.includes('exceeds the limit') || errMsg.includes('InvalidParameter'))) {
      console.log('[LLM] Video too large for recipe generation, falling back to key frames');
      return generateCookingRecipeWithFrames({
        videoTitle: params.videoTitle,
        aiSummary: params.aiSummary,
        description: params.description,
        videoUrl: params.videoUrl!,
        videoId: params.videoId!,
      });
    }
    console.error('[LLM] Cooking recipe generation failed:', error);
    throw error;
  }
}

/** 降级方案：基于关键帧生成菜谱 */
async function generateCookingRecipeWithFrames(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    videoUrl: string;
    videoId: string;
  },
): Promise<CookingRecipe | null> {
  const frameUrls = await extractKeyFrames(params.videoUrl, params.videoId, 5, 15);

  const userContent: LlmContentPart[] = [];

  const textParts = [
    `视频标题：${params.videoTitle}`,
    `AI 摘要：${params.aiSummary}`,
    params.description ? `描述：${params.description}` : '',
    `以下 ${frameUrls.length} 张截图是视频中的关键帧（按时间顺序排列）：`,
    '',
    '请将以上做菜视频内容转化为结构化菜谱步骤。',
  ].filter(Boolean).join('\n');

  userContent.push({ type: 'text', text: textParts });

  for (const url of frameUrls) {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: COOKING_RECIPE_PROMPT },
    { role: 'user', content: userContent },
  ];

  const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
    capability: 'vision',
    temperature: 0.3,
  });

  const raw = result.content.trim();
  // 尝试从 markdown 代码块中提取 JSON
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // LLM 可能拒绝生成（非做菜视频）
    console.warn('[LLM] Cooking recipe - no JSON found, LLM said:', raw.substring(0, 300));
    return null;
  }
  return JSON.parse(jsonMatch[0]) as CookingRecipe;
}

const TRAINING_PLAN_PROMPT = `你是一个专业的健身训练分析助手。请根据用户提供的健身视频内容，生成一份结构化的训练计划。

请分析视频中的训练动作，输出如下 JSON 格式：

${TRAINING_PLAN_SCHEMA}

要求：
1. workoutName 为训练名称（简短，如"全身HIIT燃脂训练"）
2. targetBodyPart 为目标部位（如"全身/胸/肩/背/腿/手臂/核心/有氧"）
3. estimatedDuration 为预计训练时长（如"20分钟"）
4. difficulty 为难度等级：beginner/intermediate/advanced
5. steps 数组，每个步骤包含：
   - step: 步骤序号
   - exerciseName: 动作名称
   - description: 动作描述和要点说明
   - sets: 组数（如"3组"，可选）
   - reps: 次数（如"12次"或"30秒"，可选）
   - counterType: 计数器类型，"counter"(计数)或"timer"(计时)或null(无)
   - counterGoal: 计数器目标值（如30表示30次，60表示60秒）
   - counterUnit: 计数器单位（"次"或"秒"）
   - restSeconds: 组间休息时间（秒）
6. 如果视频中没有明显的健身内容，返回 null 即可`;

/** 用视频链接生成训练计划 */
export async function generateTrainingPlanWithVideoUrl(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    videoUrl: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<TrainingPlan | null> {
  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: `请根据以下健身视频内容生成训练计划：\n\n视频标题：${params.videoTitle}\nAI摘要：${params.aiSummary || '无'}\n描述：${params.description || '无'}`,
    },
    {
      type: 'video_url',
      video_url: { url: params.videoUrl },
    },
  ];

  const messages: LlmMessage[] = [
    { role: 'system', content: TRAINING_PLAN_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'video',
      temperature: 0.3,
    });

    const raw = result.content.trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLM] Training plan - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    return JSON.parse(jsonMatch[0]) as TrainingPlan;
  } catch {
    return null;
  }
}

/** 用关键帧生成训练计划 */
export async function generateTrainingPlanWithFrames(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    coverUrl?: string;
    videoUrl: string;
    videoId: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<TrainingPlan | null> {
  // 提取关键帧
  const frameUrls = await extractKeyFrames(params.videoUrl, params.videoId, 5, 10);

  if (frameUrls.length === 0) {
    throw new Error('Failed to extract any frames from video');
  }

  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: `请根据以下健身视频的关键帧截图，生成结构化训练计划。\n\n视频标题：${params.videoTitle}\nAI摘要：${params.aiSummary || '无'}\n描述：${params.description || '无'}`,
    },
  ];

  for (const url of frameUrls) {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: TRAINING_PLAN_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'vision',
      temperature: 0.3,
    });

    const raw = result.content.trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLM] Training plan - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    return JSON.parse(jsonMatch[0]) as TrainingPlan;
  } catch {
    return null;
  }
}

/** 生成训练计划主入口（自动选择 video_url 或 帧提取） */
export async function generateTrainingPlan(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    coverUrl?: string;
    videoUrl?: string;
    videoId: string;
  },
  customHeaders?: Record<string, string>,
): Promise<TrainingPlan | null> {
  if (params.videoUrl) {
    try {
      return await generateTrainingPlanWithVideoUrl(
        { videoTitle: params.videoTitle, aiSummary: params.aiSummary, description: params.description, videoUrl: params.videoUrl },
        customHeaders,
      );
    } catch (err) {
      console.warn('[MTA] Training plan video_url failed, fallback to frames:', (err as Error).message);
    }
  }

  // 降级到帧提取
  if (!params.videoUrl) {
    return null;
  }
  try {
    return await generateTrainingPlanWithFrames(
      { videoTitle: params.videoTitle, aiSummary: params.aiSummary, description: params.description, coverUrl: params.coverUrl, videoUrl: params.videoUrl, videoId: params.videoId },
      customHeaders,
    );
  } catch {
    return null;
  }
}

// ─── 旅游攻略生成 ───

const TRAVEL_PLAN_PROMPT = `你是一个专业的旅游攻略分析师。请根据用户提供的旅游视频内容，生成一份结构化的旅游攻略。

请分析视频中的景点、路线、美食、住宿等信息，输出如下 JSON 格式：

${TRAVEL_PLAN_SCHEMA}

要求：
1. planName 为攻略名称（简短，如"成都3日深度游攻略"）
2. destination 为目的地城市/地区
3. duration 为行程天数（如"3天2晚"）
4. budgetLevel 为预算等级：经济型/舒适型/豪华型
5. theme 为旅行主题（如"美食之旅/亲子游/文艺打卡/特种兵"）
6. overview 为整体行程概览，描述本次旅行的亮点和总体安排
7. steps 数组，每一天的行程安排，每个元素包含：
   - day: 天数序号
   - title: 当天主题标题
   - description: 当天整体描述
   - schedule: 当天时间线，每个时间段包含 time(时间), activity(活动), note(备注)
   - tips: 当天小贴士
8. tips 数组，通用旅行建议
9. 如果视频中没有明显的旅游内容，返回 null 即可`;

/** 用视频链接生成旅游攻略 */
export async function generateTravelPlanWithVideoUrl(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    videoUrl: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<TravelPlan | null> {
  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: `请根据以下旅游视频内容生成旅游攻略：\n\n视频标题：${params.videoTitle}\nAI摘要：${params.aiSummary || '无'}\n描述：${params.description || '无'}`,
    },
    {
      type: 'video_url',
      video_url: { url: params.videoUrl },
    },
  ];

  const messages: LlmMessage[] = [
    { role: 'system', content: TRAVEL_PLAN_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'video',
      temperature: 0.3,
    });

    const raw = result.content.trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLM] Travel plan - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    return JSON.parse(jsonMatch[0]) as TravelPlan;
  } catch {
    return null;
  }
}

/** 用关键帧生成旅游攻略 */
export async function generateTravelPlanWithFrames(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    coverUrl?: string;
    videoUrl: string;
    videoId: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<TravelPlan | null> {
  const frameUrls = await extractKeyFrames(params.videoUrl, params.videoId, 5, 10);

  if (frameUrls.length === 0) {
    throw new Error('Failed to extract any frames from video');
  }

  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: `请根据以下旅游视频的关键帧截图，生成结构化旅游攻略。\n\n视频标题：${params.videoTitle}\nAI摘要：${params.aiSummary || '无'}\n描述：${params.description || '无'}`,
    },
  ];

  for (const url of frameUrls) {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: TRAVEL_PLAN_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'vision',
      temperature: 0.3,
    });

    const raw = result.content.trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLM] Travel plan - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    return JSON.parse(jsonMatch[0]) as TravelPlan;
  } catch {
    return null;
  }
}

/** 纯文本生成旅游攻略（无需视频访问，最终降级方案） */
export async function generateTravelPlanFromText(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
  },
  _customHeaders?: Record<string, string>,
): Promise<TravelPlan | null> {
  const messages: LlmMessage[] = [
    { role: 'system', content: TRAVEL_PLAN_PROMPT },
    {
      role: 'user',
      content: [
        `请根据以下视频文本信息生成旅游攻略：`,
        ``,
        `视频标题：${params.videoTitle}`,
        `AI摘要：${params.aiSummary || '无'}`,
        params.description ? `描述：${params.description}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];

  try {
    const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
      capability: 'text',
      temperature: 0.3,
    });

    const raw = result.content.trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLM] Travel plan text-only - no JSON found, LLM said:', raw.substring(0, 300));
      return null;
    }
    return JSON.parse(jsonMatch[0]) as TravelPlan;
  } catch {
    return null;
  }
}

/** 生成旅游攻略主入口（自动选择 video_url / 帧提取 / 纯文本降级） */
export async function generateTravelPlan(
  params: {
    videoTitle: string;
    aiSummary: string;
    description?: string;
    coverUrl?: string;
    videoUrl?: string;
    videoId: string;
  },
  customHeaders?: Record<string, string>,
): Promise<TravelPlan | null> {
  if (params.videoUrl) {
    try {
      const plan = await generateTravelPlanWithVideoUrl(
        { videoTitle: params.videoTitle, aiSummary: params.aiSummary, description: params.description, videoUrl: params.videoUrl },
        customHeaders,
      );
      if (plan) return plan;
    } catch (err) {
      console.warn('[MTA] Travel plan video_url failed, fallback to frames:', (err as Error).message);
    }
  }

  if (params.videoUrl && params.videoId) {
    try {
      const plan = await generateTravelPlanWithFrames(
        { videoTitle: params.videoTitle, aiSummary: params.aiSummary, description: params.description, coverUrl: params.coverUrl, videoUrl: params.videoUrl, videoId: params.videoId },
        customHeaders,
      );
      if (plan) return plan;
    } catch {
      // ignore, fallback to text
    }
  }

  // 最终降级：纯文本生成
  console.log('[MTA] Travel plan falling back to text-only generation');
  return generateTravelPlanFromText(
    { videoTitle: params.videoTitle, aiSummary: params.aiSummary, description: params.description },
    customHeaders,
  );
}

/** 方案 B：提取关键帧图片传给 LLM（大视频降级） */
async function askWithKeyFrames(
  params: { question: string; videoTitle: string; aiSummary: string; videoUrl: string; videoId: string },
  _customHeaders?: Record<string, string>,
): Promise<string> {
  // 提取关键帧
  const frameUrls = await extractKeyFrames(params.videoUrl, params.videoId, 5, 10);

  if (frameUrls.length === 0) {
    throw new Error('Failed to extract any frames from video');
  }

  // 构建多模态消息：文本 + 多张关键帧截图
  const userContent: LlmContentPart[] = [
    {
      type: 'text',
      text: [
        `视频标题：${params.videoTitle}`,
        `AI 摘要（参考）：${params.aiSummary}`,
        `以下 ${frameUrls.length} 张截图是视频中的关键帧（按时间顺序排列）：`,
        '',
        `用户提问：${params.question}`,
        '',
        '请根据这些关键帧截图，详细回答用户的问题。',
      ].join('\n'),
    },
  ];

  // 添加关键帧图片
  for (const url of frameUrls) {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: QA_FRAMES_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const result = await invokeDefaultLlm(DEFAULT_WORKSPACE_ID, messages, {
    capability: 'vision',
    temperature: 0.7,
  });
  return result.content.trim();
}
