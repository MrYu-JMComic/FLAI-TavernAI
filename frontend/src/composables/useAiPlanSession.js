import { computed, ref } from 'vue';

// Client-side state for the "plan first, then execute" gate. The backend owns
// plan validation; this composable only tracks what the user approved, which
// steps they kept, and how far execution has got.
const PLAN_PHASES = ['idle', 'planning', 'review', 'executing', 'done'];

export function useAiPlanSession() {
  const plan = ref(null);
  const planPhase = ref('idle');
  const planExtraRequirement = ref('');
  const planProgress = ref(null);

  const planSteps = computed(() => (Array.isArray(plan.value?.steps) ? plan.value.steps : []));
  const hasPlan = computed(() => planSteps.value.length > 0);
  const selectedPlanSteps = computed(() => planSteps.value.filter((step) => step.selected !== false));
  const awaitingPlanApproval = computed(() => planPhase.value === 'review' && hasPlan.value);

  function setPlan(nextPlan) {
    const normalized = normalizePlan(nextPlan);
    plan.value = normalized;
    planProgress.value = null;
    planPhase.value = normalized ? 'review' : 'idle';
    return normalized;
  }

  function setPlanPhase(phase) {
    planPhase.value = PLAN_PHASES.includes(phase) ? phase : 'idle';
  }

  function togglePlanStep(stepId, selected) {
    updatePlanStep(stepId, { selected: Boolean(selected) });
  }

  function updatePlanStep(stepId, patch = {}) {
    if (!plan.value) return;
    const nextSteps = [];
    for (const step of planSteps.value) {
      nextSteps.push(step.id === stepId ? { ...step, ...patch } : step);
    }
    plan.value = { ...plan.value, steps: nextSteps };
  }

  /**
   * The payload the execution request carries. Returns null when the user
   * deselected every step, so callers can refuse to run an empty plan.
   */
  function buildApprovedPlan() {
    const steps = [];
    for (const step of selectedPlanSteps.value) {
      steps.push({
        id: step.id,
        section: step.section,
        intent: step.intent,
        ...(step.detail ? { detail: step.detail } : {})
      });
    }
    if (!steps.length) return null;
    return {
      approved: true,
      steps,
      ...(plan.value?.worldBookScope ? { worldBookScope: plan.value.worldBookScope } : {}),
      ...(plan.value?.notes ? { notes: plan.value.notes } : {}),
      ...(planExtraRequirement.value.trim() ? { extraRequirement: planExtraRequirement.value.trim() } : {})
    };
  }

  function applyPlanProgress(progress) {
    planProgress.value = progress && typeof progress === 'object' && Array.isArray(progress.steps)
      ? progress
      : null;
  }

  function planStepStatus(stepId) {
    for (const step of planProgress.value?.steps || []) {
      if (step.id === stepId) return step.status === 'completed' ? 'completed' : 'pending';
    }
    return '';
  }

  function resetPlan() {
    plan.value = null;
    planProgress.value = null;
    planExtraRequirement.value = '';
    planPhase.value = 'idle';
  }

  function serializePlanSession() {
    return {
      plan: plan.value,
      planPhase: planPhase.value,
      planExtraRequirement: planExtraRequirement.value,
      planProgress: planProgress.value
    };
  }

  function restorePlanSession(stored = {}) {
    const normalized = normalizePlan(stored?.plan);
    plan.value = normalized;
    planExtraRequirement.value = String(stored?.planExtraRequirement || '');
    applyPlanProgress(stored?.planProgress);
    if (!normalized) {
      planPhase.value = 'idle';
      return;
    }
    // A run interrupted mid-execution comes back as something to approve again
    // rather than something silently still running.
    planPhase.value = stored?.planPhase === 'done' ? 'done' : 'review';
  }

  return {
    applyPlanProgress,
    awaitingPlanApproval,
    buildApprovedPlan,
    hasPlan,
    plan,
    planExtraRequirement,
    planPhase,
    planProgress,
    planStepStatus,
    planSteps,
    resetPlan,
    restorePlanSession,
    selectedPlanSteps,
    serializePlanSession,
    setPlan,
    setPlanPhase,
    togglePlanStep,
    updatePlanStep
  };
}

function normalizePlan(value) {
  const steps = Array.isArray(value?.steps) ? value.steps : [];
  const normalizedSteps = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] && typeof steps[index] === 'object' ? steps[index] : {};
    const intent = String(step.intent || '').trim();
    if (!intent) continue;
    normalizedSteps.push({
      id: String(step.id || `step-${index + 1}`),
      section: String(step.section || ''),
      intent,
      detail: String(step.detail || ''),
      selected: step.selected !== false
    });
  }
  if (!normalizedSteps.length) return null;
  return {
    steps: normalizedSteps,
    ...(value?.worldBookScope ? { worldBookScope: String(value.worldBookScope) } : {}),
    notes: String(value?.notes || ''),
    risks: Array.isArray(value?.risks) ? value.risks.map((risk) => String(risk || '')).filter(Boolean) : []
  };
}
