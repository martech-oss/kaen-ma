import { api } from "@/api";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: string;
}

export async function getCurrentWorkspace(): Promise<Workspace> {
  const response = await api<Workspace>("/workspace");
  return response.data;
}
