export type CellStatus = "idle" | "generating" | "ready" | "error";

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
  error_message: string | null;
  current_result: CellResult | null;
  selected_for_export: boolean;
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
  export_order: string[];
};

export type ProjectSummary = Pick<Project, "id" | "name" | "updated_at">;

