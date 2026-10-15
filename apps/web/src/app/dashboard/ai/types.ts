export interface AiSettings {
  outputChannelId?: string;
  triggers: { mention: boolean; words: string[]; roleIds: string[] };
  persona: string;
  tone: 'friendly' | 'concise' | 'formal' | 'playful';
  indexingNoticeAcknowledged: boolean;
  learning: { autoLearn: boolean; paused: boolean };
  retrieval: { maxSources: number; recentTurns: number };
  vision: { enabled: boolean; maxBytes: number };
  escalation: { enabled: boolean; minQuestionChars: number };
  budget: { monthlyTargetUsd: number; warnAtUsd: number; lowCostAtUsd: number; hardStopUsd: number; hardStopEnabled: boolean };
  pricing: { model: string; inputPerMTokUsd: number; outputPerMTokUsd: number; note: string }[];
  limits: { perUserPerMinute: number; concurrentPerUser: number; globalPerMinute: number };
}
