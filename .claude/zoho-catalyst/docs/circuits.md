FILE_PURPOSE: Read when building or triggering Catalyst workflow automation using Circuits — orchestrating Basic I/O functions sequentially or in parallel with conditional branching.
TRIGGER_KEYWORDS: Circuits, circuit state, workflow orchestration, Pass state, Branch state, Parallel state, JsonPath, circuit input, circuit output, circuit JSON
SOURCE_DOC: help-docs/circuits.md

TECHNICAL_CONSTRAINTS:
- NOT available: EU, AU, IN, JP, SA, CA data centers (6 DCs blocked)
- Only Basic I/O functions can be executed inside a circuit — Cron, Event, and Advanced I/O functions are NOT supported
- Circuit I/O format: JSON only (key-value pairs); this matches Basic I/O function I/O format
- Circuit defined as a JSON file; can be built visually (drag-and-drop) or coded directly in console
- Can be triggered via: console (manual), API, server SDK (Java/Node.js/Python), or Cron
- States are traversed step-by-step; each state has Previous and Next references
- Path expressions use JsonPath library (external); syntax: `$.fieldName` or `$.field1,field2`
- Flow control states: Pass, Branch, Parallel, Wait, Batch, Success, Failure
- Functional states: Function (executes a Basic I/O function), Circuit (calls a nested circuit)

REQUIRED_PARAMETERS:
- Circuit input: JSON key-value pairs provided at initiation
- State configuration per state: type, next (next state name), input_path (JsonPath), output_path (JsonPath), result_path (JsonPath)
- input_path: selects subset of state input to pass to task
- output_path: selects subset of state output to pass to next state
- result_path: appends state result to input JSON as a new key; merged output passed forward
- Start: first state = any state not referenced as "next" by another state
- End: last state = state with no "next" key defined

UI_ONLY_ACTIONS:
- Create circuit (visual): Console → Serverless → Circuits → Create Circuit → drag-and-drop states → configure each state
- Create circuit (JSON): Console → Circuits → Create Circuit → JSON editor tab → write circuit JSON → Save
- Test circuit execution: Console → Circuits → open circuit → Test → provide JSON input → Run
- View execution logs: Console → Circuits → open circuit → Execution History → click execution row
- Edit circuit: Console → Circuits → open circuit → Edit → modify visual or JSON → Save
- Delete circuit: Console → Circuits → open circuit → ellipsis → Delete → confirm
- Note: Circuit execution can also be triggered via API and SDKs; JSON definition can be pulled/pushed via CLI

CRITICAL_FAILURE_MODES:
- Using Cron/Event/Advanced I/O functions inside a circuit: silently fails or errors at execution — only Basic I/O supported
- Incorrect JsonPath syntax in input_path/output_path/result_path: circuit execution fails with path evaluation error; test in console before deploying
- result_path collision: if result_path key already exists in input JSON, it is overwritten silently
- Circuit called from a data center where Circuits is unavailable: feature simply does not exist in console; no workaround
- Circular circuit references (Circuit state calling parent circuit): causes infinite loop; no cycle detection at save time
- Parallel state: all branches execute concurrently; if one branch fails, behavior depends on circuit failure handling config — ensure Failure state is defined
