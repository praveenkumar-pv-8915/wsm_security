FILE_PURPOSE: Read when building ML pipelines or data pipelines in Catalyst QuickML — no-code model training, data profiling, or pipeline execution.
TRIGGER_KEYWORDS: QuickML, ML pipeline, data pipeline, machine learning, no-code ML, data profiling, QuickML pipeline builder, ML model, drag-and-drop pipeline
SOURCE_DOC: help-docs/quickml.md

TECHNICAL_CONSTRAINTS:
- NOT available in CA (Canada), JP (Japan), SA (Saudi Arabia) data centers
- Fully no-code: drag-and-drop pipeline builder; no SDK or API for pipeline creation
- Two modules:
  - ML Pipelines: end-to-end model training, evaluation, and deployment
  - Data Pipelines: data preprocessing and transformation (can run independently or as part of ML pipeline)
- Data import sources: Zoho services, AWS S3, Google Cloud Storage, local file system
- Data profiling: automatically runs on uploaded datasets; provides record counts, data types, missing values, statistical details (sum/min/max/mean/median/std dev/variance for numeric; unique/duplicates for categorical)
- Pipeline stages are sequential; each stage configures an individual ML or data processing sub-task
- Output preview available per stage in the builder interface

REQUIRED_PARAMETERS:
- Dataset: uploaded via console (CSV or supported format from Zoho services / external storage)
- Pipeline: configured via drag-and-drop builder in console; no YAML or code required
- ML algorithms and AI features are available as pre-built atomic stages in the builder

UI_ONLY_ACTIONS:
- Access QuickML: Console → QuickML (or Amplify → QuickML depending on console version)
- Create ML pipeline: Console → QuickML → ML Pipelines → Create Pipeline → drag-and-drop stages → configure each stage → Execute
- Create Data pipeline: Console → QuickML → Data Pipelines → Create Pipeline → drag-and-drop → configure → Execute
- Upload dataset: Console → QuickML → Datasets → Upload → select source (local/S3/GCloud/Zoho service) → Import
- View data profiling: Console → QuickML → Datasets → click dataset → Data Profiling tab
- Note: All pipeline building and execution is console-only; no CLI or SDK for pipeline management

CRITICAL_FAILURE_MODES:
- Accessing from CA/JP/SA DC: QuickML section absent from console — no workaround
- Expecting code/API access: QuickML is entirely no-code; there is no SDK or REST API for creating or configuring pipelines
- Data type mismatch in ML stage: if column types detected during profiling don't match expected input for a chosen algorithm, stage will fail at execution; check data profiling output before configuring ML stages
