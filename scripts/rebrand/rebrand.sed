# SearchT rebrand substitution table (GNU sed).
# Order matters: identifiers first, then blanket tokens, then guarded AionUi passes.
s/resolveZhixuStoragePaths/resolveSearchtStoragePaths/g
s/ZhixuConnectorInterest/SearchtConnectorInterest/g
s/ZhixuModelBoundary/SearchtModelBoundary/g
s/ZhixuMemoryMCP/SearchtMemoryMCP/g
s/isZhixuUpdateServiceConfigured/isSearchtUpdateServiceConfigured/g
s/zhixu_memory_propose/searcht_memory_propose/g
s/zhixu_memory_retrieve/searcht_memory_retrieve/g
s/AionUiImportCategory/SearchtImportCategory/g
s/AionUiImportDiscovery/SearchtImportDiscovery/g
s/AionUiImportPlanCategory/SearchtImportPlanCategory/g
s/AionUiImportPlan/SearchtImportPlan/g
s/AionUiImportReportCategory/SearchtImportReportCategory/g
s/AionUiImportReport/SearchtImportReport/g
s/AionUiImportStatus/SearchtImportStatus/g
s/AionUiMigrationFileIO/SearchtMigrationFileIO/g
s/AionUiMigrationOptions/SearchtMigrationOptions/g
s/AionUiMigrationReportStore/SearchtMigrationReportStore/g
s/AionUiMigrationService/SearchtMigrationService/g
s/AionUiMigrationStore/SearchtMigrationStore/g
s/NodeAionUiMigrationFileIO/NodeSearchtMigrationFileIO/g
s/SqliteAionUiImportReportStore/SqliteSearchtImportReportStore/g
s/discoverAionUiImport/discoverSearchtImport/g
s/listAionUiImports/listSearchtImports/g
s/planAionUiImport/planSearchtImport/g
s/rollbackAionUiImport/rollbackSearchtImport/g
s/runAionUiImport/runSearchtImport/g
s/zhixu-desktop/searcht-ui/g
s/ZHIXU_UNIT_TEST/SEARCHT_UNIT_TEST/g
s/ZHIXU/SEARCHT/g
s/知序/SearchT/g
s/Zhixu/SearchT/g
s/zhixu/searcht/g
# AionUi brand strings -> SearchT, skipping lines with functional legacy tokens.
/aionui\.db\|aionui-config\.txt\|aionui-backend\.db\|aionui-chat\|\.aionui-env\|aionui\.dir\|'AionUi'\|"AionUi"\|AionCore\|iOfficeAI/!s/AionUi/SearchT/g
/aionui\.db\|aionui-config\.txt\|aionui-backend\.db\|aionui-chat\|\.aionui-env\|aionui\.dir\|'AionUi'\|"AionUi"\|AionCore\|iOfficeAI/!s/AIONUI/SEARCHT/g
# Internal installer temp artifacts (hyphen/underscore prefixed names).
/aionui\.db\|aionui-config\.txt\|aionui-backend\.db\|aionui-chat\|\.aionui-env\|aionui\.dir/!s/aionui-/searcht-/g
/aionui\.db\|aionui-config\.txt\|aionui-backend\.db\|aionui-chat\|\.aionui-env\|aionui\.dir/!s/aionui_/searcht_/g
