export type MemoryVisualMode = 'startup' | 'balanced' | 'full' | 'light';

export interface MemoryVisualProfile {
  mode: MemoryVisualMode;
  fps: number;
  stars: number;
  nebulae: number;
  ribbons: number;
  sparkles: number;
  clouds: number;
  pointSamples: number;
  glowLayers: number;
  ribbonPasses: number;
  shootingStars: boolean;
  crossStars: boolean;
  trails: boolean;
  ambientGlow: boolean;
}

export interface MemoryVisualProfileInput {
  isDark: boolean;
  isVisible: boolean;
  devicePixelRatio: number;
  prefersReducedMotion: boolean;
  interactionActive: boolean;
  booting: boolean;
}

export interface MemoryVisualObjectCounts {
  stars: number;
  nebulae: number;
  ribbons: number;
  sparkles: number;
  clouds: number;
}

export type MemoryVisualGrowthMode = 'immediate' | 'deferred';

export const MEMORY_VISUAL_PROFILES: Record<MemoryVisualMode, MemoryVisualProfile> = {
  startup: {
    mode: 'startup',
    fps: 24,
    stars: 90,
    nebulae: 2,
    ribbons: 2,
    sparkles: 48,
    clouds: 4,
    pointSamples: 48,
    glowLayers: 1,
    ribbonPasses: 1,
    shootingStars: false,
    crossStars: false,
    trails: false,
    ambientGlow: false,
  },
  balanced: {
    mode: 'balanced',
    fps: 36,
    stars: 180,
    nebulae: 4,
    ribbons: 3,
    sparkles: 120,
    clouds: 7,
    pointSamples: 84,
    glowLayers: 2,
    ribbonPasses: 2,
    shootingStars: true,
    crossStars: true,
    trails: false,
    ambientGlow: true,
  },
  full: {
    mode: 'full',
    fps: 48,
    stars: 260,
    nebulae: 6,
    ribbons: 4,
    sparkles: 180,
    clouds: 9,
    pointSamples: 120,
    glowLayers: 2,
    ribbonPasses: 3,
    shootingStars: true,
    crossStars: true,
    trails: true,
    ambientGlow: true,
  },
  light: {
    mode: 'light',
    fps: 18,
    stars: 60,
    nebulae: 1,
    ribbons: 1,
    sparkles: 18,
    clouds: 4,
    pointSamples: 36,
    glowLayers: 1,
    ribbonPasses: 1,
    shootingStars: false,
    crossStars: false,
    trails: false,
    ambientGlow: false,
  },
};

const MEMORY_VISUAL_GROWTH_BATCH: Record<keyof MemoryVisualObjectCounts, number> = {
  stars: 36,
  nebulae: 1,
  ribbons: 1,
  sparkles: 28,
  clouds: 2,
};

export function getMemoryVisualObjectCounts(profile: MemoryVisualProfile): MemoryVisualObjectCounts {
  return {
    stars: profile.stars,
    nebulae: profile.nebulae,
    ribbons: profile.ribbons,
    sparkles: profile.sparkles,
    clouds: profile.clouds,
  };
}

export function createMemoryVisualObjectCounts(): MemoryVisualObjectCounts {
  return {
    stars: 0,
    nebulae: 0,
    ribbons: 0,
    sparkles: 0,
    clouds: 0,
  };
}

export function expandMemoryVisualObjectCounts(
  current: MemoryVisualObjectCounts,
  profile: MemoryVisualProfile,
  growthMode: MemoryVisualGrowthMode,
) {
  const target = getMemoryVisualObjectCounts(profile);
  const next: MemoryVisualObjectCounts = {
    stars:
      growthMode === 'immediate'
        ? target.stars
        : current.stars > target.stars
          ? Math.max(target.stars, current.stars - MEMORY_VISUAL_GROWTH_BATCH.stars)
          : Math.min(target.stars, Math.max(current.stars, 0) + MEMORY_VISUAL_GROWTH_BATCH.stars),
    nebulae:
      growthMode === 'immediate'
        ? target.nebulae
        : current.nebulae > target.nebulae
          ? Math.max(target.nebulae, current.nebulae - MEMORY_VISUAL_GROWTH_BATCH.nebulae)
          : Math.min(target.nebulae, Math.max(current.nebulae, 0) + MEMORY_VISUAL_GROWTH_BATCH.nebulae),
    ribbons:
      growthMode === 'immediate'
        ? target.ribbons
        : current.ribbons > target.ribbons
          ? Math.max(target.ribbons, current.ribbons - MEMORY_VISUAL_GROWTH_BATCH.ribbons)
          : Math.min(target.ribbons, Math.max(current.ribbons, 0) + MEMORY_VISUAL_GROWTH_BATCH.ribbons),
    sparkles:
      growthMode === 'immediate'
        ? target.sparkles
        : current.sparkles > target.sparkles
          ? Math.max(target.sparkles, current.sparkles - MEMORY_VISUAL_GROWTH_BATCH.sparkles)
          : Math.min(target.sparkles, Math.max(current.sparkles, 0) + MEMORY_VISUAL_GROWTH_BATCH.sparkles),
    clouds:
      growthMode === 'immediate'
        ? target.clouds
        : current.clouds > target.clouds
          ? Math.max(target.clouds, current.clouds - MEMORY_VISUAL_GROWTH_BATCH.clouds)
          : Math.min(target.clouds, Math.max(current.clouds, 0) + MEMORY_VISUAL_GROWTH_BATCH.clouds),
  };

  return {
    next,
    completed:
      next.stars === target.stars &&
      next.nebulae === target.nebulae &&
      next.ribbons === target.ribbons &&
      next.sparkles === target.sparkles &&
      next.clouds === target.clouds,
  };
}

export function resolveMemoryVisualProfile(input: MemoryVisualProfileInput) {
  if (!input.isVisible || input.prefersReducedMotion) {
    return MEMORY_VISUAL_PROFILES.light;
  }

  if (input.booting) {
    return MEMORY_VISUAL_PROFILES.startup;
  }

  // Keep the dense visual layer stable during clicks and drags.
  // Interaction can still influence animation behavior elsewhere, but should not
  // abruptly reduce visible stars, ribbons, or sparkles.
  if (!input.isDark || input.devicePixelRatio > 1.5) {
    return MEMORY_VISUAL_PROFILES.balanced;
  }

  return MEMORY_VISUAL_PROFILES.full;
}
