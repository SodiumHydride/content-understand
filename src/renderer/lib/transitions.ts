/**
 * Transition presets for view switches, modals, and reader panels.
 * All presets use CSS animation classes defined in animations.css.
 */
export const transitions = {
  viewSwitch: {
    enter: 'animate-view-enter',
    exit: 'animate-view-exit',
    duration: 200,
  },
  modalOpen: {
    enter: 'animate-scale-in',
    exit: 'animate-scale-out',
    duration: 150,
  },
  slideIn: {
    enter: 'animate-slide-in-right',
    exit: 'animate-slide-out-right',
    duration: 250,
  },
} as const

export type TransitionPreset = keyof typeof transitions
