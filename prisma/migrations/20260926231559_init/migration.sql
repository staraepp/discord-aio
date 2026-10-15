-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'system', 'bot');

-- CreateEnum
CREATE TYPE "PanelKind" AS ENUM ('verification', 'ticket', 'tempvc', 'rolepanel', 'music', 'embed', 'tempvc_controls', 'honeypot');

-- CreateEnum
CREATE TYPE "DashboardCommandStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('exact', 'starts_with', 'ends_with', 'contains', 'regex');

-- CreateEnum
CREATE TYPE "AutoresponderResponseType" AS ENUM ('text', 'embed', 'random', 'actions_only');

-- CreateEnum
CREATE TYPE "MusicSessionKind" AS ENUM ('public', 'temp');

-- CreateEnum
CREATE TYPE "MusicSessionState" AS ENUM ('idle', 'playing', 'paused', 'suspended', 'stopped');

-- CreateEnum
CREATE TYPE "LoopMode" AS ENUM ('off', 'track', 'queue');

-- CreateEnum
CREATE TYPE "TempVisibility" AS ENUM ('public', 'private', 'friends');

-- CreateEnum
CREATE TYPE "FormQuestionType" AS ENUM ('section', 'short_text', 'long_text', 'single_choice', 'multiple_choice', 'dropdown', 'checkbox', 'number', 'date');

-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('new', 'reviewing', 'accepted', 'denied', 'archived');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('warn', 'timeout', 'untimeout', 'kick', 'voicekick', 'ban', 'tempban', 'softban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'lockdown', 'honeypot', 'automod');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "VerificationAttemptResult" AS ENUM ('pending', 'success', 'failed', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "RolePanelKind" AS ENUM ('button', 'select', 'reaction');

-- CreateEnum
CREATE TYPE "RoleOptionBehavior" AS ENUM ('toggle', 'add', 'remove');

-- CreateEnum
CREATE TYPE "AISummaryStatus" AS ENUM ('active', 'stale', 'archived');

-- CreateEnum
CREATE TYPE "AIMemoryStatus" AS ENUM ('proposed', 'learned', 'pinned', 'archived', 'superseded');

-- CreateEnum
CREATE TYPE "HoneypotAction" AS ENUM ('delete_alert', 'kick', 'softban', 'ban');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "musicStaffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticketStaffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auditLogChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleConfig" (
    "guildId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ModuleConfig_pkey" PRIMARY KEY ("guildId","moduleId")
);

-- CreateTable
CREATE TABLE "GuildCounter" (
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GuildCounter_pkey" PRIMARY KEY ("guildId","name")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'user',
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedEmbed" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "componentActions" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersistentPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" "PanelKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersistentPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardCommand" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "status" "DashboardCommandStatus" NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "DashboardCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotHeartbeat" (
    "id" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "botUserId" TEXT,
    "botTag" TEXT,
    "latencyMs" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppErrorLog" (
    "id" TEXT NOT NULL,
    "errorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DashboardSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Autoresponder" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "matchMode" "MatchMode" NOT NULL DEFAULT 'contains',
    "caseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "responseType" "AutoresponderResponseType" NOT NULL DEFAULT 'text',
    "responses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedId" TEXT,
    "allowedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "deleteTrigger" BOOLEAN NOT NULL DEFAULT false,
    "deleteResponseAfterSeconds" INTEGER,
    "logUses" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Autoresponder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoresponderAction" (
    "id" TEXT NOT NULL,
    "autoresponderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AutoresponderAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicPlayerIdentity" (
    "slot" INTEGER NOT NULL,
    "botUserId" TEXT,
    "label" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicPlayerIdentity_pkey" PRIMARY KEY ("slot")
);

-- CreateTable
CREATE TABLE "MusicSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "textChannelId" TEXT,
    "kind" "MusicSessionKind" NOT NULL DEFAULT 'public',
    "identitySlot" INTEGER,
    "state" "MusicSessionState" NOT NULL DEFAULT 'idle',
    "cursor" INTEGER NOT NULL DEFAULT -1,
    "positionMs" INTEGER NOT NULL DEFAULT 0,
    "positionUpdatedAt" TIMESTAMP(3),
    "volume" INTEGER NOT NULL DEFAULT 100,
    "loopMode" "LoopMode" NOT NULL DEFAULT 'off',
    "is247" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB,
    "nextPosition" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicQueueEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "requesterId" TEXT NOT NULL,
    "staffAdded" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "durationMs" INTEGER,
    "uri" TEXT,
    "sourceName" TEXT NOT NULL,
    "encoded" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "isStream" BOOLEAN NOT NULL DEFAULT false,
    "isSeekable" BOOLEAN NOT NULL DEFAULT true,
    "isrc" TEXT,
    "resolvedFrom" TEXT,
    "originalUri" TEXT,
    "substitutionNote" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicNowPlayingPanel" (
    "sessionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "lyricsMessageId" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "MusicNowPlayingPanel_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "MusicHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "sessionKind" "MusicSessionKind" NOT NULL DEFAULT 'public',
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "uri" TEXT,
    "sourceName" TEXT NOT NULL,
    "durationMs" INTEGER,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicLyricsCacheMetadata" (
    "id" TEXT NOT NULL,
    "trackKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "synced" BOOLEAN NOT NULL DEFAULT false,
    "attribution" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicLyricsCacheMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempVoicePreset" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "nameTemplate" TEXT NOT NULL DEFAULT '{emoji} {user.display_name}''s room',
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "bitrate" INTEGER,
    "visibility" "TempVisibility" NOT NULL DEFAULT 'public',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TempVoicePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempVoiceRoom" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "visibility" "TempVisibility" NOT NULL DEFAULT 'public',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "allowedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "presetId" TEXT,
    "controlMessageId" TEXT,
    "graceUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TempVoiceRoom_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "LevelProfile" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastMessageXpAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelProfile_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "LevelRoleReward" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "LevelRoleReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "accentColor" TEXT NOT NULL DEFAULT '#6d5dfc',
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "closedMessage" TEXT NOT NULL DEFAULT 'This form is currently closed.',
    "successMessage" TEXT NOT NULL DEFAULT 'Thanks! Your response has been recorded.',
    "allowEdit" BOOLEAN NOT NULL DEFAULT false,
    "editConfirmationText" TEXT NOT NULL DEFAULT 'Save this private link if you want to edit your response later. Anyone with the link can edit it, so don''t share it.',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormQuestion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "FormQuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validation" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "FormQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'new',
    "adminNotes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "FormAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormEditTokenHash" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "FormEditTokenHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "type" "CaseType" NOT NULL,
    "targetId" TEXT,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "durationMs" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "evidence" TEXT,
    "messageLink" TEXT,
    "channelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCaseEdit" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationCaseEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationNote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketType" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "style" TEXT NOT NULL DEFAULT 'primary',
    "categoryId" TEXT,
    "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questions" JSONB NOT NULL DEFAULT '[]',
    "waitingNameTemplate" TEXT NOT NULL DEFAULT 'waiting-{user.name}',
    "handledNameTemplate" TEXT NOT NULL DEFAULT '{staff.name}-{user.name}',
    "openingMessage" TEXT NOT NULL DEFAULT 'Hi {user}, thanks for reaching out. A staff member will be with you soon.',

    CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "typeId" TEXT,
    "openerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "firstResponderId" TEXT,
    "nameLocked" BOOLEAN NOT NULL DEFAULT false,
    "handlerId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketParticipant" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY ("ticketId","userId")
);

-- CreateTable
CREATE TABLE "TicketTranscript" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "challengeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "result" "VerificationAttemptResult" NOT NULL DEFAULT 'pending',
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCooldown" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "failuresInCycle" INTEGER NOT NULL DEFAULT 0,
    "cyclesFailed" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "pendingRoleSync" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCooldown_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "RolePanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RolePanelKind" NOT NULL DEFAULT 'button',
    "template" JSONB NOT NULL,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "maxRoles" INTEGER,
    "requiredRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logChannelId" TEXT,
    "placeholder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePanelOption" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "description" TEXT,
    "style" TEXT NOT NULL DEFAULT 'secondary',
    "behavior" "RoleOptionBehavior" NOT NULL DEFAULT 'toggle',

    CONSTRAINT "RolePanelOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIChannelConfig" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "collect" BOOLEAN NOT NULL DEFAULT true,
    "searchable" BOOLEAN NOT NULL DEFAULT true,
    "attachments" BOOLEAN NOT NULL DEFAULT false,
    "learnMemory" BOOLEAN NOT NULL DEFAULT false,
    "historyDepth" INTEGER NOT NULL DEFAULT 0,
    "citationPriority" INTEGER NOT NULL DEFAULT 0,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "privateConfirmedBy" TEXT,
    "privateConfirmedAt" TIMESTAMP(3),
    "lastBackfillAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIChannelConfig_pkey" PRIMARY KEY ("guildId","channelId")
);

-- CreateTable
CREATE TABLE "AIIndexedMessage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "jumpUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search" tsvector,

    CONSTRAINT "AIIndexedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAttachmentReference" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AIAttachmentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISummary" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "sourceMessageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AISummaryStatus" NOT NULL DEFAULT 'active',
    "editedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMemory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "AIMemoryStatus" NOT NULL DEFAULT 'proposed',
    "supersededById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'ai',
    "provenance" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMemorySource" (
    "memoryId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "jumpUrl" TEXT NOT NULL,

    CONSTRAINT "AIMemorySource_pkey" PRIMARY KEY ("memoryId","messageId")
);

-- CreateTable
CREATE TABLE "AIConversationTurn" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProviderEncryptedCredential" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "encryptedKey" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "chatModel" TEXT NOT NULL,
    "escalationModel" TEXT,
    "visionModel" TEXT,
    "extractionModel" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProviderEncryptedCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageLedger" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "credentialId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoneypotConfig" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "action" "HoneypotAction" NOT NULL DEFAULT 'delete_alert',
    "exemptRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exemptUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logChannelId" TEXT,
    "warningEmbedId" TEXT,
    "deleteMessage" BOOLEAN NOT NULL DEFAULT true,
    "dmUser" BOOLEAN NOT NULL DEFAULT false,
    "dmMessage" TEXT NOT NULL DEFAULT 'You posted in a trap channel in {server.name}. Staff have been notified.',
    "actionConfirmedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoneypotConfig_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_guildId_module_createdAt_idx" ON "AuditLog"("guildId", "module", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "SavedEmbed_guildId_idx" ON "SavedEmbed"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedEmbed_guildId_name_key" ON "SavedEmbed"("guildId", "name");

-- CreateIndex
CREATE INDEX "PersistentPanel_guildId_kind_idx" ON "PersistentPanel"("guildId", "kind");

-- CreateIndex
CREATE INDEX "PersistentPanel_messageId_idx" ON "PersistentPanel"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "PersistentPanel_kind_refId_key" ON "PersistentPanel"("kind", "refId");

-- CreateIndex
CREATE INDEX "DashboardCommand_status_createdAt_idx" ON "DashboardCommand"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AppErrorLog_createdAt_idx" ON "AppErrorLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AppErrorLog_errorId_idx" ON "AppErrorLog"("errorId");

-- CreateIndex
CREATE INDEX "DashboardSession_userId_idx" ON "DashboardSession"("userId");

-- CreateIndex
CREATE INDEX "Autoresponder_guildId_enabled_idx" ON "Autoresponder"("guildId", "enabled");

-- CreateIndex
CREATE INDEX "AutoresponderAction_autoresponderId_position_idx" ON "AutoresponderAction"("autoresponderId", "position");

-- CreateIndex
CREATE INDEX "MusicSession_identitySlot_idx" ON "MusicSession"("identitySlot");

-- CreateIndex
CREATE UNIQUE INDEX "MusicSession_guildId_voiceChannelId_key" ON "MusicSession"("guildId", "voiceChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicQueueEntry_sessionId_position_key" ON "MusicQueueEntry"("sessionId", "position");

-- CreateIndex
CREATE INDEX "MusicHistory_guildId_playedAt_idx" ON "MusicHistory"("guildId", "playedAt" DESC);

-- CreateIndex
CREATE INDEX "MusicHistory_guildId_requesterId_idx" ON "MusicHistory"("guildId", "requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicLyricsCacheMetadata_trackKey_key" ON "MusicLyricsCacheMetadata"("trackKey");

-- CreateIndex
CREATE UNIQUE INDEX "TempVoicePreset_guildId_name_key" ON "TempVoicePreset"("guildId", "name");

-- CreateIndex
CREATE INDEX "TempVoiceRoom_guildId_deletedAt_idx" ON "TempVoiceRoom"("guildId", "deletedAt");

-- CreateIndex
CREATE INDEX "TempVoiceRoom_ownerId_idx" ON "TempVoiceRoom"("ownerId");

-- CreateIndex
CREATE INDEX "LevelProfile_guildId_xp_idx" ON "LevelProfile"("guildId", "xp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LevelRoleReward_guildId_level_roleId_key" ON "LevelRoleReward"("guildId", "level", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Form_slug_key" ON "Form"("slug");

-- CreateIndex
CREATE INDEX "Form_guildId_idx" ON "Form"("guildId");

-- CreateIndex
CREATE INDEX "FormQuestion_formId_position_idx" ON "FormQuestion"("formId", "position");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_createdAt_idx" ON "FormSubmission"("formId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FormSubmission_formId_status_idx" ON "FormSubmission"("formId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FormAnswer_submissionId_questionId_key" ON "FormAnswer"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "FormEditTokenHash_submissionId_key" ON "FormEditTokenHash"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "FormEditTokenHash_tokenHash_key" ON "FormEditTokenHash"("tokenHash");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_targetId_idx" ON "ModerationCase"("guildId", "targetId");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_type_active_idx" ON "ModerationCase"("guildId", "type", "active");

-- CreateIndex
CREATE INDEX "ModerationCase_expiresAt_idx" ON "ModerationCase"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationCase_guildId_caseNumber_key" ON "ModerationCase"("guildId", "caseNumber");

-- CreateIndex
CREATE INDEX "ModerationCaseEdit_caseId_idx" ON "ModerationCaseEdit"("caseId");

-- CreateIndex
CREATE INDEX "ModerationNote_guildId_targetId_idx" ON "ModerationNote"("guildId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPanel_guildId_name_key" ON "TicketPanel"("guildId", "name");

-- CreateIndex
CREATE INDEX "TicketType_panelId_position_idx" ON "TicketType"("panelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");

-- CreateIndex
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");

-- CreateIndex
CREATE INDEX "Ticket_openerId_idx" ON "Ticket"("openerId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket"("guildId", "number");

-- CreateIndex
CREATE INDEX "TicketTranscript_ticketId_idx" ON "TicketTranscript"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAttempt_tokenHash_key" ON "VerificationAttempt"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationAttempt_guildId_userId_createdAt_idx" ON "VerificationAttempt"("guildId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RolePanel_guildId_name_key" ON "RolePanel"("guildId", "name");

-- CreateIndex
CREATE INDEX "RolePanelOption_panelId_position_idx" ON "RolePanelOption"("panelId", "position");

-- CreateIndex
CREATE INDEX "AIIndexedMessage_guildId_channelId_createdAt_idx" ON "AIIndexedMessage"("guildId", "channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AIIndexedMessage_search_idx" ON "AIIndexedMessage" USING GIN ("search");

-- CreateIndex
CREATE INDEX "AIAttachmentReference_messageId_idx" ON "AIAttachmentReference"("messageId");

-- CreateIndex
CREATE INDEX "AISummary_guildId_channelId_periodEnd_idx" ON "AISummary"("guildId", "channelId", "periodEnd" DESC);

-- CreateIndex
CREATE INDEX "AIMemory_guildId_status_idx" ON "AIMemory"("guildId", "status");

-- CreateIndex
CREATE INDEX "AIMemorySource_messageId_idx" ON "AIMemorySource"("messageId");

-- CreateIndex
CREATE INDEX "AIMemorySource_channelId_idx" ON "AIMemorySource"("channelId");

-- CreateIndex
CREATE INDEX "AIConversationTurn_guildId_channelId_createdAt_idx" ON "AIConversationTurn"("guildId", "channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AIProviderEncryptedCredential_guildId_priority_idx" ON "AIProviderEncryptedCredential"("guildId", "priority");

-- CreateIndex
CREATE INDEX "AIUsageLedger_guildId_createdAt_idx" ON "AIUsageLedger"("guildId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AutoresponderAction" ADD CONSTRAINT "AutoresponderAction_autoresponderId_fkey" FOREIGN KEY ("autoresponderId") REFERENCES "Autoresponder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicQueueEntry" ADD CONSTRAINT "MusicQueueEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MusicSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicNowPlayingPanel" ADD CONSTRAINT "MusicNowPlayingPanel_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MusicSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormQuestion" ADD CONSTRAINT "FormQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "FormQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormEditTokenHash" ADD CONSTRAINT "FormEditTokenHash_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCaseEdit" ADD CONSTRAINT "ModerationCaseEdit_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "TicketPanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTranscript" ADD CONSTRAINT "TicketTranscript_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePanelOption" ADD CONSTRAINT "RolePanelOption_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "RolePanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAttachmentReference" ADD CONSTRAINT "AIAttachmentReference_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AIIndexedMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMemorySource" ADD CONSTRAINT "AIMemorySource_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "AIMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text search vector for AI retrieval. Maintained by trigger so Prisma never writes it.
CREATE OR REPLACE FUNCTION aio_ai_message_search_update() RETURNS trigger AS $$
BEGIN
  NEW."search" := to_tsvector('simple', coalesce(NEW."authorName", '') || ' ' || coalesce(NEW."content", ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER aio_ai_message_search_trigger
BEFORE INSERT OR UPDATE OF "content", "authorName" ON "AIIndexedMessage"
FOR EACH ROW EXECUTE FUNCTION aio_ai_message_search_update();
