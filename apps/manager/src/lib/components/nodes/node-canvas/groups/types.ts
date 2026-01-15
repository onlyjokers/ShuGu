export type NodeGroup = {
  id: string;
  parentId: string | null;
  name: string;
  nodeIds: string[];
  disabled: boolean;
  minimized: boolean;
  runtimeActive?: boolean;
};
