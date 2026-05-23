/**
 * MTA (More Than Asking) Router
 * 做菜教程步骤生成 + 历史记录管理
 */
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { videos, mtaRecipes } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { generateCookingRecipe, generateTrainingPlan, generateTravelPlan, generateDeepResearch } from '../connectors/llm-connector.js';
import { researchDocs } from '../db/schema.js';
import { getSignedUrl } from '../connectors/storage-connector.js';

const t = initTRPC.create();

/** 做菜相关的关键词（高置信度） */
const COOKING_KEYWORDS = [
  '做菜', '烹饪', '食谱', '料理', '烘焙', '炒', '煎', '煮', '炸',
  '蒸', '烤', '焖', '炖', '拌', '调味', '食材', '菜谱', '厨房',
  '家常菜', '下厨', '快手菜', '一道菜', '步骤', '份量', '配料',
  '腌制', '焯水', '翻炒', '出锅', '火候', '油温', '锅气',
];

/** 低置信度词 — 需要组合出现才判定 */
const WEAK_KEYWORDS = ['美食', '教程', '好吃', '美味'];

/** 检测视频是否为做菜教程 */
function isCookingVideo(
  tags: string[],
  title: string,
  description: string | null,
  aiSummary: string | null,
): boolean {
  const textToCheck = [
    ...tags,
    title,
    description || '',
    aiSummary || '',
  ].join(' ').toLowerCase();

  // 高置信度关键词命中一个即判定
  const hasStrongKeyword = COOKING_KEYWORDS.some(kw => textToCheck.includes(kw));
  if (hasStrongKeyword) return true;

  // 低置信度词需要至少命中两个
  const weakCount = WEAK_KEYWORDS.filter(kw => textToCheck.includes(kw)).length;
  return weakCount >= 2;
}

export const mtaRouter = t.router({
  /** 检测视频是否为做菜教程 */
  detectCooking: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const [video] = await db.select().from(videos).where(eq(videos.id, input.videoId)).limit(1);

      if (!video) {
        return { isCooking: false };
      }

      const isCooking = isCookingVideo(
        video.tags ? JSON.parse(video.tags as string) : [],
        video.title || '',
        video.description,
        video.aiSummary,
      );

      return { isCooking };
    }),

  /** 生成做菜步骤卡片（自动保存到数据库） */
  generateRecipe: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
      category: z.enum(['training', 'recipes', 'planning', 'deep_research']).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const [video] = await db.select().from(videos).where(eq(videos.id, input.videoId)).limit(1);

        if (!video) {
          return { error: '视频不存在' };
        }

        if (!video.aiSummary) {
          return { error: '视频摘要尚未生成，请稍后重试' };
        }

        // 获取视频签名 URL（如果有视频文件）
        let videoUrl: string | undefined;
        if (video.videoFileKey) {
          try {
            videoUrl = await getSignedUrl(video.videoFileKey);
          } catch {
            // 忽略，降级为摘要分析
          }
        }

        // 获取封面签名 URL
        let coverUrl = video.coverUrl;
        if (video.coverFileKey) {
          try {
            coverUrl = await getSignedUrl(video.coverFileKey);
          } catch {
            // 使用原始 URL
          }
        }

        const recipe = await generateCookingRecipe({
          videoTitle: video.title || '未知视频',
          aiSummary: video.aiSummary,
          description: video.description || undefined,
          coverUrl: coverUrl || undefined,
          videoUrl,
          videoId: video.id,
        });

        if (!recipe) {
          return { error: '该视频不是做菜教程，无法生成菜谱卡片' };
        }

        console.log('[MTA] Generated recipe:', JSON.stringify(recipe).substring(0, 200));

        // 保存到数据库
        const recipeId = nanoid();
        try {
          await db.insert(mtaRecipes).values({
            id: recipeId,
            workspaceId: input.workspaceId,
            videoId: input.videoId,
            videoTitle: video.title,
            coverUrl: video.coverUrl,
            dishName: recipe.dishName,
            servings: recipe.servings,
            ingredients: JSON.stringify(recipe.ingredients),
            steps: JSON.stringify(recipe.steps),
            category: input.category || 'recipes',
          });
          console.log('[MTA] Saved recipe with id:', recipeId);
        } catch (dbError) {
          console.error('[MTA] Failed to save recipe to DB:', dbError);
        }

        return { recipe, recipeId };
      } catch (error) {
        console.error('[MTA] Recipe generation failed:', error);
        return { error: '菜谱生成失败，请稍后重试' };
      }
    }),

  /** 获取 MTA 历史记录列表 */
  list: t.procedure
    .input(z.object({
      workspaceId: z.string(),
      limit: z.number().min(1).max(50).default(20),
      offset: z.number().min(0).default(0),
      category: z.enum(['training', 'recipes', 'planning', 'research']).optional(),
    }))
    .query(async ({ input }) => {
      const whereConditions = input.category
        ? and(eq(mtaRecipes.workspaceId, input.workspaceId), eq(mtaRecipes.category, input.category))
        : eq(mtaRecipes.workspaceId, input.workspaceId);

      const items = await db
        .select()
        .from(mtaRecipes)
        .where(whereConditions)
        .orderBy(desc(mtaRecipes.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: mtaRecipes.id })
        .from(mtaRecipes)
        .where(whereConditions);

      const safeJsonParse = (str: string | null, fallback: unknown = []) => {
        if (!str) return fallback;
        try { return JSON.parse(str); } catch { return typeof fallback === 'string' ? str : fallback; }
      };

      return {
        items: items.map(item => ({
          id: item.id,
          videoId: item.videoId,
          videoTitle: item.videoTitle,
          coverUrl: item.coverUrl,
          dishName: item.dishName,
          servings: item.servings,
          category: item.category,
          ingredients: Array.isArray(safeJsonParse(item.ingredients, [])) ? safeJsonParse(item.ingredients, []) : [item.ingredients],
          steps: safeJsonParse(item.steps, []),
          cooldown: safeJsonParse(item.cooldown, []),
          createdAt: item.createdAt?.getTime() ?? Date.now(),
        })),
        total: countResult.length,
      };
    }),

  /** 获取单条 MTA 记录详情 */
  detail: t.procedure
    .input(z.object({
      recipeId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const [record] = await db
        .select()
        .from(mtaRecipes)
        .where(eq(mtaRecipes.id, input.recipeId))
        .limit(1);

      if (!record) {
        return null;
      }

      const safeJsonParse = (str: string | null, fallback: unknown = []) => {
        if (!str) return fallback;
        try { return JSON.parse(str); } catch { return typeof fallback === 'string' ? str : fallback; }
      };

      return {
        id: record.id,
        videoId: record.videoId,
        videoTitle: record.videoTitle,
        coverUrl: record.coverUrl,
        dishName: record.dishName,
        servings: record.servings,
        ingredients: Array.isArray(safeJsonParse(record.ingredients, [])) ? safeJsonParse(record.ingredients, []) : [record.ingredients],
        steps: safeJsonParse(record.steps, []),
        cooldown: safeJsonParse(record.cooldown, []),
        category: record.category,
        createdAt: record.createdAt?.getTime() ?? Date.now(),
      };
    }),

  /** 检测视频是否为健身/训练教程 */
  detectTraining: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) {
        return { isTraining: false };
      }

      const trainingKeywords = ['健身', '训练', '运动', '锻炼', '增肌', '减脂', '塑形', '有氧', '无氧', 'HIIT', '拉伸', '热身', '力量', '体能', '瑜伽', '普拉提', '肌肉', '深蹲', '硬拉', '卧推', '俯卧撑', '卷腹', '平板支撑', '开合跳', '波比跳', '哑铃', '杠铃', '壶铃', '弹力带', '跑步机', '跳绳', '骑行', '游泳', '跑步', '马拉松', '体能训练', '功能性训练', '核心训练', '臀腿', '背部', '胸部', '肩部', '手臂', '腹肌', 'tabata', '燃脂', '暴汗', '跟练', '教程', '健身博主', '教练', '健身房', '居家健身', '徒手训练'];
      const textToCheck = [
        ...(video.tags || []),
        video.title || '',
        video.description || '',
        video.aiSummary || '',
      ].join(' ').toLowerCase();
      const isTraining = trainingKeywords.some(k => textToCheck.includes(k.toLowerCase()));
      return { isTraining };
    }),

  /** 生成健身训练计划 */
  generateTraining: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
      category: z.enum(['training', 'recipes', 'planning', 'research']).default('training'),
    }))
    .mutation(async ({ input }) => {
      console.log('[MTA] Generating training plan for video:', input.videoId);

      const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) {
        return { error: '视频不存在' };
      }

      if (!video.videoFileKey) {
        return { error: '视频文件未找到，无法分析训练内容' };
      }

      try {
        const videoUrl = await getSignedUrl(video.videoFileKey);
        if (!videoUrl) {
          return { error: '视频链接生成失败' };
        }

        const plan = await generateTrainingPlan({
          videoTitle: video.title || '无标题视频',
          aiSummary: video.aiSummary || '',
          description: video.description || '',
          videoUrl,
          videoId: input.videoId,
        });

        if (!plan) {
          return { error: '训练计划生成失败，请稍后重试' };
        }

        // 保存到数据库
        const planId = nanoid();
        try {
          await db.insert(mtaRecipes).values({
            id: planId,
            workspaceId: input.workspaceId,
            videoId: input.videoId,
            videoTitle: video.title,
            coverUrl: video.coverUrl,
            dishName: plan.workoutName,
            servings: `${plan.duration} · ${plan.difficulty}`,
            ingredients: JSON.stringify(plan.warmup || []),
            steps: JSON.stringify(plan.steps),
            cooldown: JSON.stringify(plan.cooldown || []),
            category: input.category || 'training',
          });
          console.log('[MTA] Saved training plan with id:', planId);
        } catch (dbError) {
          console.error('[MTA] Failed to save training plan to DB:', dbError);
        }

        return { plan, planId };
      } catch (error) {
        console.error('[MTA] Training plan generation failed:', error);
        return { error: '训练计划生成失败，请稍后重试' };
      }
    }),

  /** 检测视频是否为旅游攻略 */
  detectPlanning: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) {
        return { isPlanning: false };
      }

      const travelKeywords = ['旅游', '旅行', '攻略', '游记', '打卡', '景点', '景区', '游玩', '度假', '自由行', '跟团', '酒店', '民宿', '客栈', '美食街', '夜市', '当地特色', '必吃', '必玩', '必去', '推荐', '路线', '行程', '日程', 'Day', '第几天', '护照', '签证', '机票', '高铁', '火车票', '租车', '自驾', '徒步', '露营', '海边', '山区', '古镇', '古城', '博物馆', '美术馆', '公园', '乐园', ' Disneyland', '迪士尼', '环球', '海洋馆', '动物园', '植物园', '爬山', '看海', '日出', '日落', '夜景', '逛街', '购物', '免税店', '伴手礼', '特产'];
      const textToCheck = [
        ...(video.tags || []),
        video.title || '',
        video.description || '',
        video.aiSummary || '',
      ].join(' ').toLowerCase();
      const isPlanning = travelKeywords.some(k => textToCheck.includes(k.toLowerCase()));
      return { isPlanning };
    }),

  /** 生成旅游攻略 */
  generatePlanning: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
      category: z.enum(['training', 'recipes', 'planning', 'research']).default('planning'),
    }))
    .mutation(async ({ input }) => {
      console.log('[MTA] Generating travel plan for video:', input.videoId);

      const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) {
        return { error: '视频不存在' };
      }

      if (!video.videoFileKey) {
        return { error: '视频文件未找到，无法分析旅游内容' };
      }

      try {
        const videoUrl = await getSignedUrl(video.videoFileKey);
        if (!videoUrl) {
          return { error: '视频链接生成失败' };
        }

        const plan = await generateTravelPlan({
          videoTitle: video.title || '无标题视频',
          aiSummary: video.aiSummary || '',
          description: video.description || '',
          videoUrl,
          videoId: input.videoId,
        });

        if (!plan) {
          return { error: '旅游攻略生成失败，请稍后重试' };
        }

        const planId = nanoid();
        try {
          await db.insert(mtaRecipes).values({
            id: planId,
            workspaceId: input.workspaceId,
            videoId: input.videoId,
            videoTitle: video.title,
            coverUrl: video.coverUrl,
            dishName: plan.planName,
            servings: `${plan.duration} · ${plan.budgetLevel}`,
            ingredients: JSON.stringify(plan.tips || []),
            steps: JSON.stringify(plan.steps),
            category: input.category || 'planning',
          });
          console.log('[MTA] Saved travel plan with id:', planId);
        } catch (dbError) {
          console.error('[MTA] Failed to save travel plan to DB:', dbError);
        }

        return { plan, planId };
      } catch (error) {
        console.error('[MTM] Travel plan generation failed:', error);
        return { error: '旅游攻略生成失败，请稍后重试' };
      }
    }),

  /** 删除 MTA 记录 */
  delete: t.procedure
    .input(z.object({
      recipeId: z.string(),
      workspaceId: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.delete(mtaRecipes).where(eq(mtaRecipes.id, input.recipeId));
      return { success: true };
    }),

  /** 深度研究：生成研究报告 */
  research: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
      topic: z.string().min(1).max(200),
    }))
    .mutation(async ({ input }) => {
      const [video] = await db.select().from(videos).where(
        and(eq(videos.id, input.videoId), eq(videos.workspaceId, input.workspaceId))
      ).limit(1);

      if (!video) {
        return { error: '视频未找到' };
      }

      try {
        const content = await generateDeepResearch({
          videoTitle: video.title || '无标题视频',
          aiSummary: video.aiSummary || '',
          description: video.description || '',
          topic: input.topic,
        });

        return { content };
      } catch (error) {
        console.error('[MTA] Deep research failed:', error);
        return { error: '深度研究生成失败，请稍后重试' };
      }
    }),

  /** 深度研究：保存文档 */
  researchSave: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
      title: z.string().min(1).max(200),
      topic: z.string().min(1).max(200),
      content: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const docId = nanoid();
      await db.insert(researchDocs).values({
        id: docId,
        workspaceId: input.workspaceId,
        videoId: input.videoId,
        title: input.title,
        topic: input.topic,
        content: input.content,
      });
      // 同步插入 mta_recipes 以便在 MTA 列表中显示
      await db.insert(mtaRecipes).values({
        id: docId,
        workspaceId: input.workspaceId,
        videoId: input.videoId,
        category: 'research',
        videoTitle: input.title,
        coverUrl: '',
        dishName: input.title,
        servings: input.topic,
        ingredients: input.content.substring(0, 500),
        steps: '[]',
        cooldown: '',
      });
      return { docId };
    }),

  /** 深度研究：列出某视频下的文档 */
  researchList: t.procedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const docs = await db.select().from(researchDocs).where(
        and(eq(researchDocs.videoId, input.videoId), eq(researchDocs.workspaceId, input.workspaceId))
      ).orderBy(desc(researchDocs.createdAt));
      return docs;
    }),

  /** 深度研究：获取文档详情 */
  researchDetail: t.procedure
    .input(z.object({
      docId: z.string(),
      workspaceId: z.string(),
    }))
    .query(async ({ input }) => {
      const [doc] = await db.select().from(researchDocs).where(
        and(eq(researchDocs.id, input.docId), eq(researchDocs.workspaceId, input.workspaceId))
      ).limit(1);
      return doc || null;
    }),

  /** 深度研究：删除文档 */
  researchDelete: t.procedure
    .input(z.object({
      docId: z.string(),
      workspaceId: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.delete(researchDocs).where(eq(researchDocs.id, input.docId));
      await db.run(sql`DELETE FROM "mta_recipes" WHERE "id" = ${input.docId}`);
      return { success: true };
    }),

  /** 深度研究：导出文档 */
  researchExport: t.procedure
    .input(z.object({
      docId: z.string(),
      workspaceId: z.string(),
      format: z.enum(['pdf', 'docx', 'html']),
    }))
    .mutation(async ({ input }) => {
      const [doc] = await db.select().from(researchDocs).where(
        and(eq(researchDocs.id, input.docId), eq(researchDocs.workspaceId, input.workspaceId))
      ).limit(1);
      if (!doc) {
        return { error: '文档未找到' };
      }

      const { spawn } = await import('child_process');
      const { writeFile, readFile, unlink } = await import('fs/promises');
      const tmpMd = `/tmp/research_${input.docId}.md`;
      const ext = input.format;
      const tmpOut = `/tmp/research_${input.docId}.${ext}`;
      const filename = `${doc.title || '研究文档'}.${ext}`;

      let mimeType = 'application/octet-stream';
      if (input.format === 'pdf') mimeType = 'application/pdf';
      else if (input.format === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (input.format === 'html') mimeType = 'text/html';

      try {
        await writeFile(tmpMd, doc.content, 'utf-8');
        const args = [tmpMd, '-o', tmpOut];
        if (input.format === 'pdf') {
          args.push('--pdf-engine=wkhtmltopdf');
          args.push('--metadata', `title=${doc.title || '研究文档'}`);
        }
        if (input.format === 'html') {
          args.push('-s');
        }

        await new Promise<void>((resolve, reject) => {
          const proc = spawn('pandoc', args, {
            env: { ...process.env, XDG_RUNTIME_DIR: '/tmp' },
          });
          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pandoc failed: ${stderr}`));
          });
        });

        const buffer = await readFile(tmpOut);
        const base64 = buffer.toString('base64');
        return { base64, filename, mimeType };
      } catch (err) {
        console.error('[MTA] Export failed:', err);
        return { error: '导出失败，请稍后重试' };
      } finally {
        try { await unlink(tmpMd); } catch { /* ignore */ }
        try { await unlink(tmpOut); } catch { /* ignore */ }
      }
    }),
});
