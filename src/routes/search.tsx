import { createFileRoute } from "@tanstack/react-router"
import { AgenticSearch } from "~/components/AgenticSearch"

export const Route = createFileRoute("/search")({
  component: SearchComponent,
})

function SearchComponent() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900">
            Ask Your News Feed
          </h1>
          <p className="mt-2 text-lg text-gray-600">
            Ask questions about your saved articles using AI-powered semantic search
          </p>
        </div>
        <AgenticSearch />
      </div>
    </div>
  )
}
