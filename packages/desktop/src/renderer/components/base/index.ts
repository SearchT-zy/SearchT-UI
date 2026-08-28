/**
 * @license
 * Copyright 2025 SearchT Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SearchT 基础组件库统一导出 / SearchT base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// ==================== 组件导出 / Component Exports ====================

export { default as SearchtModal } from './SearchtModal';
export { default as SearchtCollapse } from './SearchtCollapse';
export { default as SearchtSelect } from './SearchtSelect';
export { default as SearchtScrollArea } from './SearchtScrollArea';
export { default as SearchtSteps } from './SearchtSteps';
export { default as SearchtSearchInput } from './SearchtSearchInput';
export { default as SearchtInlineSearchInput } from './SearchtInlineSearchInput';

// ==================== 类型导出 / Type Exports ====================

// SearchtModal 类型 / SearchtModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  SearchtModalProps,
} from './SearchtModal';
export { MODAL_SIZES } from './SearchtModal';

// SearchtCollapse 类型 / SearchtCollapse types
export type { SearchtCollapseProps, SearchtCollapseItemProps } from './SearchtCollapse';

// SearchtSelect 类型 / SearchtSelect types
export type { SearchtSelectProps } from './SearchtSelect';

// SearchtSteps 类型 / SearchtSteps types
export type { SearchtStepsProps } from './SearchtSteps';

// SearchtSearchInput 类型 / SearchtSearchInput types
export type { SearchtSearchInputProps } from './SearchtSearchInput';

// SearchtInlineSearchInput 类型 / SearchtInlineSearchInput types
export type { SearchtInlineSearchInputProps } from './SearchtInlineSearchInput';
