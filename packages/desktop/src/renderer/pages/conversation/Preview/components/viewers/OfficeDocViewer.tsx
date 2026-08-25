/**
 * @license
 * Copyright 2025 SearchT-UI Contributors (Apache-2.0)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ChatFileRef } from '@/common/types/chatFile';
import OfficeWatchViewer from './OfficeWatchViewer';

interface OfficeDocPreviewProps {
  fileRef?: ChatFileRef;
  file_path?: string;
  content?: string;
  workspace?: string;
}

const OfficeDocPreview: React.FC<OfficeDocPreviewProps> = (props) => <OfficeWatchViewer docType='word' {...props} />;

export default OfficeDocPreview;
