/**
 * DingTalk API module exports.
 * Provides access token management and proactive message sending.
 */

export {
  createTokenManager,
  createTokenManagerFromAccount,
  clearAllTokens,
  invalidateToken,
  type TokenManager,
  type TokenManagerOptions,
} from "./token-manager.js";

export {
  sendProactiveMessage,
  sendBatchDirectMessage,
  sendImageMessage,
  sendImageMessageWithMediaId,
  sendFileMessage,
  sendActionCardMessage,
  sendMediaByPath,
  parseTarget,
  type MessageTarget,
  type SendMessageOptions,
  type SendMessageResult,
  type SendImageOptions,
  type SendFileOptions,
  type SendMediaByPathOptions,
} from "./send-message.js";

export {
  uploadMedia,
  downloadMedia,
  type UploadMediaResult,
  type DownloadMediaResult,
} from "./media.js";

export {
  createCardInstance,
  createAndDeliverCardInstance,
  updateCardInstance,
  appendCardSpaces,
  deliverCardInstance,
  type CardInstanceResult,
  type CreateCardInstanceOptions,
  type CreateAndDeliverCardOptions,
  type UpdateCardInstanceOptions,
  type AppendCardSpacesOptions,
  type DeliverCardInstanceOptions,
} from "./card-instances.js";

export {
  uploadMediaToOAPI,
  uploadLocalFile,
  isLocalPath,
  normalizeLocalPath,
  isImageUrl,
  detectMediaType,
  type MediaType,
  type UploadMediaResult as UploadMediaToOAPIResult,
} from "./media-upload.js";
