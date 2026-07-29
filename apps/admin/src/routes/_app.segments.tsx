import { createFileRoute } from "@tanstack/react-router";
import { SegmentsPage } from "../App";

export const Route = createFileRoute("/_app/segments")({
  component: SegmentsPage,
});
