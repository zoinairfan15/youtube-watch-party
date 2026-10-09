export type Role = "host" | "moderator" | "participant";

export interface Participant {
  id: string;
  username: string;
  role: Role;
}