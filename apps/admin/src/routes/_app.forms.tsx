import { createFileRoute } from "@tanstack/react-router";
import { FormsPage } from "../App";

export const Route = createFileRoute("/_app/forms")({
  component: FormsPage,
});
