import { assertCoach } from "@/lib/role";
import { NextResponse } from "next/server";
import { toCsv, toXlsx } from "@/lib/export";
import { toPdf } from "@/lib/pdf";
import { toPrintPdf } from "@/lib/print";
import { toProgramFile } from "@/lib/program-file";
import { toRepwiseTsv, toRepwiseXlsx } from "@/lib/repwise";
import { prisma } from "@/lib/prisma";
import { getProgramBlocks } from "@/lib/queries";
import { loadSettings } from "@/lib/coach-settings";
import { exportFileName } from "@/lib/branding";

/** A header that carries any name — accents and all — to the browser. */
function disposition(kind: "attachment" | "inline", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request) {
  assertCoach();
  await loadSettings();
  const { searchParams } = new URL(request.url);
  const blockId = searchParams.get("blockId");
  const requested = searchParams.get("format");
  const FORMATS = ["csv", "pdf", "print", "json", "repwise", "repwise-tsv"] as const;
  const format = FORMATS.find((f) => f === requested) ?? "xlsx";

  if (!blockId) return NextResponse.json({ error: "blockId is required" }, { status: 400 });

  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: {
      athlete: true,
      program: { select: { id: true, name: true } },
      weeks: {
        orderBy: { order: "asc" },
        include: {
          days: {
            orderBy: { index: "asc" },
            include: {
              rows: {
                orderBy: { order: "asc" },
                include: { rules: { orderBy: { order: "asc" } } },
              },
            },
          },
        },
      },
    },
  });

  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });

  const stem = exportFileName({
    athlete: block.athlete.name,
    program: block.program.name,
    phase: block.phase,
  });
  const extension =
    format === "json"
      ? "topset.json"
      : format === "repwise"
        ? "repwise.xlsx"
        : format === "repwise-tsv"
          ? "repwise.tsv"
          : format;
  const filename = `${stem}.${extension}`;

  if (format === "json") {
    // The file carries the whole program, not just the phase that was open.
    const program = await prisma.program.findUniqueOrThrow({
      where: { id: block.programId },
      include: {
        phases: {
          orderBy: { order: "asc" },
          include: {
            weeks: {
              orderBy: { order: "asc" },
              include: {
                days: {
                  orderBy: { index: "asc" },
                  include: {
                    rows: {
                      orderBy: { order: "asc" },
                      include: { rules: { orderBy: { order: "asc" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return new NextResponse(JSON.stringify(toProgramFile(program), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": disposition("attachment", filename),
      },
    });
  }

  if (format === "repwise-tsv") {
    return new NextResponse(toRepwiseTsv(block), {
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": disposition("attachment", filename),
      },
    });
  }

  if (format === "repwise") {
    const workbook = await toRepwiseXlsx(block);
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": disposition("attachment", filename),
      },
    });
  }

  if (format === "csv") {
    return new NextResponse(toCsv(block), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition("attachment", filename),
      },
    });
  }

  if (format === "print") {
    const week = Number(searchParams.get("week"));
    const only = Number.isInteger(week) && week > 0 ? week : undefined;
    return new NextResponse(new Uint8Array(toPrintPdf(block, only)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition("inline", `${stem}${only ? ` - week ${only}` : ""} - print.pdf`),
      },
    });
  }

  if (format === "pdf") {
    return new NextResponse(new Uint8Array(toPdf(block)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition("inline", filename),
      },
    });
  }

  // The spreadsheet is the whole program, a sheet per phase, whichever phase was open.
  const phases = await getProgramBlocks(block.programId);
  const buffer = await toXlsx(phases);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition("attachment", `${stem}.xlsx`),
    },
  });
}
