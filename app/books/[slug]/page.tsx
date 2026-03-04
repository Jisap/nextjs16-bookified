import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, MicOff, Mic } from "lucide-react";

import { getBookBySlug } from "@/lib/actions/book.actions";
import VapiControls from "@/components/VapiControls";

export default async function BookDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const { slug } = await params;
  const result = await getBookBySlug(slug);

  if (!result.success || !result.data) {
    redirect("/");
  }

  const book = result.data; // Book data

  return (
    <div className="book-page-container">
      <Link href="/" className="back-btn-floating">
        <ArrowLeft className="size-6 text-[#212a3b]" />
      </Link>

      <div className="book-page-container">
        {/* Floating back button */}
        <Link href="/" className="back-btn-floating">
          <ArrowLeft className="size-6 text-[#212a3b]" />
        </Link>

        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 pt-8">
          {/* 1. Header card */}
          <div className="vapi-header-card">
            <div className="flex items-start gap-6">
              {/* Cover image with mic button overlay */}
              <div className="relative shrink-0">
                <Image
                  src={book.coverURL}
                  alt={book.title}
                  width={120}
                  height={180}
                  className="rounded-lg shadow-lg object-cover"
                  style={{ width: 120, height: 180 }}
                />
                {/* Mic button overlapping bottom-right corner of cover */}
                <button
                  className="vapi-mic-btn"
                  aria-label="Start microphone"
                  style={{
                    position: "absolute",
                    bottom: -12,
                    right: -12,
                  }}
                >
                  <MicOff className="size-6 text-[#212a3b]" />
                </button>
              </div>

              {/* Book info */}
              <div className="flex flex-col justify-start gap-3 pt-1">
                <div>
                  <h1 className="font-serif text-2xl font-bold text-[#212a3b] leading-tight sm:text-3xl">
                    {book.title}
                  </h1>
                  <p className="mt-1 text-base text-[#6b7280]">
                    by {book.author}
                  </p>
                </div>

                {/* Status pill badges */}
                <div className="flex flex-wrap gap-2">
                  {/* Status: Ready */}
                  <span className="vapi-status-indicator">
                    <span className="vapi-status-dot" />
                    <span className="vapi-status-text">Ready</span>
                  </span>

                  {/* Voice label */}
                  <span className="vapi-status-indicator">
                    <span className="vapi-status-text">Voice: {book.persona}</span>
                  </span>

                  {/* Timer */}
                  <span className="vapi-status-indicator">
                    <span className="vapi-status-text">0:00 / 15:00</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Transcript area */}
          <div className="transcript-container">
            <div className="transcript-empty">
              <Mic className="size-12 text-[#9ca3af]" />
              <p className="transcript-empty-text">No conversation yet</p>
              <p className="transcript-empty-hint">
                Click the mic button above to start talking
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Se le pasa el libro */}
      <VapiControls book={book} />
    </div>
  );
}