export type CellStatus = "idle" | "queued" | "generating" | "ready" | "error";
export type CellDisplayStatus = "not_generated" | "queued" | "generating" | "unplayed" | "played" | "error";

export type CellResult = {
  audio_path: string;
  sample_rate: number;
  generated_at: string;
  seed: number | null;
  duration_sec: number;
};

export type ReferenceItem = {
  id: string;
  label: string;
  source_filename: string;
  copied_path: string;
  duration_sec: number;
};

export type LineItem = {
  id: string;
  text: string;
  order_index: number;
};

export type CellItem = {
  id: string;
  line_id: string;
  reference_id: string;
  status: CellStatus;
  display_status: CellDisplayStatus;
  error_message: string | null;
  current_result: CellResult | null;
};

export type ExportPlaylistItem = {
  id: string;
  cell_id: string;
  line_id: string;
  reference_id: string;
  label: string;
  created_at: string;
};

export type GenerationJob = {
  id: string;
  project_id: string;
  kind: "generate_missing" | "generate_all" | "regenerate_cell";
  status: "running" | "completed" | "failed";
  total_cells: number;
  completed_cells: number;
  target_cell_ids: string[];
  active_cell_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type GenerationProgress = {
  running_job_count: number;
  running_job_kinds: GenerationJob["kind"][];
  has_running_jobs: boolean;
  active_jobs: {
    job_id: string;
    kind: GenerationJob["kind"];
    cell_id: string;
    line_index: number;
    reference_label: string;
    status: "queued" | "generating";
  }[];
};

export type AppLogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  event: string;
  project_id: string | null;
  job_id: string | null;
  message: string;
  context: Record<string, string | number | boolean | null>;
};

export type Project = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  checkpoint: string;
  model_device: string;
  model_precision: string;
  codec_device: string;
  codec_precision: string;
  num_steps: number;
  cfg_scale_text: number;
  cfg_scale_speaker: number;
  references: ReferenceItem[];
  lines: LineItem[];
  cells: CellItem[];
  generation_progress: GenerationProgress;
  export_playlist: ExportPlaylistItem[];
};

export type ProjectSummary = Pick<Project, "id" | "name" | "updated_at">;

