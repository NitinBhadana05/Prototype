import HubSpotIntegration from "@/components/integrations/HubSpot";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            EPHY HubSpot Prototype
          </h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            AI-Powered HR Compliance SaaS — HubSpot Integration
          </p>
        </div>
        <HubSpotIntegration />
      </div>
    </main>
  );
}
