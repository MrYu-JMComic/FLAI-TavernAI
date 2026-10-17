import { buildStatusTemplateReferenceGroups } from '../../../shared/statusTemplateSyntax.js';

// Quick reference rendered inside the template editors. It is built from the
// shared syntax module, so the chat drawer, the character blueprint editor and
// the AI tool prompts always describe the same grammar.
export const STATUS_TEMPLATE_REFERENCE = Object.freeze(buildStatusTemplateReferenceGroups());
