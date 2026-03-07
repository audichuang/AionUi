/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { ASSISTANT_PRESETS } from '@/common/presets/assistantPresets';
import { getActivityTime, getTimelineLabel } from '@/renderer/utils/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspaceHistory';

import type { AssistantGroup, GroupedHistoryResult, TimelineItem, TimelineSection, WorkspaceGroup } from '../types';

export const getConversationTimelineLabel = (conversation: TChatConversation, t: (key: string) => string): string => {
  const time = getActivityTime(conversation);
  return getTimelineLabel(time, Date.now(), t);
};

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return getActivityTime(conversation);
};

/**
 * 从对话 extra 中提取 presetAssistantId
 * Extract presetAssistantId from conversation extra
 */
const getPresetAssistantId = (conv: TChatConversation): string | null => {
  const extra = conv.extra as { presetAssistantId?: string; enabledSkills?: string[] } | undefined;
  const presetAssistantId = typeof extra?.presetAssistantId === 'string' ? extra.presetAssistantId.trim() : '';
  if (presetAssistantId) return presetAssistantId.replace('builtin-', '');

  // 向后兼容: Gemini Cowork 旧会话 / Backward compat: old Gemini Cowork conversations
  if (conv.type === 'gemini' && Array.isArray(extra?.enabledSkills) && extra.enabledSkills.length > 0) {
    return 'cowork';
  }
  return null;
};

/**
 * 解析 assistant 显示信息（名称、头像），找不到时返回 null
 * Resolve assistant display info (name, avatar). Returns null if unknown.
 */
const resolveAssistantDisplayInfo = (assistantId: string, locale: string, customAgents?: Array<{ id: string; name?: string; avatar?: string; nameI18n?: Record<string, string> }>): { displayName: string; avatar: string; isEmoji: boolean } | null => {
  // 1. 从内置预设查找 / Look up in built-in presets
  const preset = ASSISTANT_PRESETS.find((p) => p.id === assistantId);
  if (preset) {
    const name = preset.nameI18n[locale] || preset.nameI18n['en-US'] || preset.id;
    const avatar = typeof preset.avatar === 'string' ? preset.avatar : '';
    const isEmoji = !avatar || !avatar.endsWith('.svg');
    return { displayName: name, avatar: isEmoji ? avatar || '🤖' : avatar, isEmoji };
  }

  // 2. 从自定义 agents 查找 / Look up in custom agents
  if (customAgents) {
    const custom = customAgents.find((a) => a.id === assistantId || a.id === `builtin-${assistantId}`);
    if (custom) {
      const resolveLocaleKey = (lang: string) => (lang.startsWith('zh') ? 'zh-CN' : 'en-US');
      const localeKey = resolveLocaleKey(locale);
      const name = custom.nameI18n?.[localeKey] || custom.name || assistantId;
      const avatar = typeof custom.avatar === 'string' ? custom.avatar : '';
      const isEmoji = !avatar || !avatar.endsWith('.svg');
      return { displayName: name, avatar: isEmoji ? avatar || '🤖' : avatar, isEmoji };
    }
  }

  // 未知 assistant（已删除等），不分组 / Unknown assistant (deleted etc.), don't group
  return null;
};

export const groupConversationsByTimelineAndWorkspace = (conversations: TChatConversation[], t: (key: string) => string, locale: string = 'en-US', customAgents?: Array<{ id: string; name?: string; avatar?: string; nameI18n?: Record<string, string> }>): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const allAssistantGroups = new Map<string, TChatConversation[]>();
  const withoutGroupConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const customWorkspace = conv.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      // 检查是否有已知的 assistant 分组 / Check for known assistant grouping
      const assistantId = getPresetAssistantId(conv);
      if (assistantId && resolveAssistantDisplayInfo(assistantId, locale, customAgents)) {
        if (!allAssistantGroups.has(assistantId)) {
          allAssistantGroups.set(assistantId, []);
        }
        allAssistantGroups.get(assistantId)!.push(conv);
      } else {
        withoutGroupConvs.push(conv);
      }
    }
  });

  const workspaceGroupsByTimeline = new Map<string, WorkspaceGroup[]>();

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].sort((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConv = sortedConvs[0];
    const timeline = getConversationTimelineLabel(latestConv, t);

    if (!workspaceGroupsByTimeline.has(timeline)) {
      workspaceGroupsByTimeline.set(timeline, []);
    }

    workspaceGroupsByTimeline.get(timeline)!.push({
      workspace,
      displayName: getWorkspaceDisplayName(workspace),
      conversations: sortedConvs,
    });
  });

  // 按 assistant 分组 / Group by assistant
  const assistantGroupsByTimeline = new Map<string, AssistantGroup[]>();

  allAssistantGroups.forEach((convList, assistantId) => {
    const sortedConvs = [...convList].sort((a, b) => getActivityTime(b) - getActivityTime(a));
    const latestConv = sortedConvs[0];
    const timeline = getConversationTimelineLabel(latestConv, t);

    if (!assistantGroupsByTimeline.has(timeline)) {
      assistantGroupsByTimeline.set(timeline, []);
    }

    const info = resolveAssistantDisplayInfo(assistantId, locale, customAgents);
    if (!info) return; // Already validated in classification, safety check only
    assistantGroupsByTimeline.get(timeline)!.push({
      assistantId,
      displayName: info.displayName,
      avatar: info.avatar,
      isEmoji: info.isEmoji,
      conversations: sortedConvs,
    });
  });

  const withoutGroupByTimeline = new Map<string, TChatConversation[]>();

  withoutGroupConvs.forEach((conv) => {
    const timeline = getConversationTimelineLabel(conv, t);
    if (!withoutGroupByTimeline.has(timeline)) {
      withoutGroupByTimeline.set(timeline, []);
    }
    withoutGroupByTimeline.get(timeline)!.push(conv);
  });

  const timelineOrder = ['conversation.history.today', 'conversation.history.yesterday', 'conversation.history.recent7Days', 'conversation.history.earlier'];
  const sections: TimelineSection[] = [];

  timelineOrder.forEach((timelineKey) => {
    const timeline = t(timelineKey);
    const withWorkspace = workspaceGroupsByTimeline.get(timeline) || [];
    const withAssistant = assistantGroupsByTimeline.get(timeline) || [];
    const withoutGroup = withoutGroupByTimeline.get(timeline) || [];

    if (withWorkspace.length === 0 && withAssistant.length === 0 && withoutGroup.length === 0) return;

    const items: TimelineItem[] = [];

    withWorkspace.forEach((group) => {
      const updateTime = getWorkspaceUpdateTime(group.workspace);
      const time = updateTime > 0 ? updateTime : getActivityTime(group.conversations[0]);
      items.push({
        type: 'workspace',
        time,
        workspaceGroup: group,
      });
    });

    withAssistant.forEach((group) => {
      items.push({
        type: 'assistant',
        time: getActivityTime(group.conversations[0]),
        assistantGroup: group,
      });
    });

    withoutGroup.forEach((conv) => {
      items.push({
        type: 'conversation',
        time: getActivityTime(conv),
        conversation: conv,
      });
    });

    items.sort((a, b) => b.time - a.time);

    sections.push({
      timeline,
      items,
    });
  });

  return sections;
};

export const buildGroupedHistory = (conversations: TChatConversation[], t: (key: string) => string, locale: string = 'en-US', customAgents?: Array<{ id: string; name?: string; avatar?: string; nameI18n?: Record<string, string> }>): GroupedHistoryResult => {
  const pinnedConversations = conversations.filter((conversation) => isConversationPinned(conversation)).sort((a, b) => getConversationPinnedAt(b) - getConversationPinnedAt(a));

  const normalConversations = conversations.filter((conversation) => !isConversationPinned(conversation));

  return {
    pinnedConversations,
    timelineSections: groupConversationsByTimelineAndWorkspace(normalConversations, t, locale, customAgents),
  };
};
