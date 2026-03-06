#!/usr/bin/env node

/**
 * Apollo Service (Consolidated)
 *
 * Search + match leads, write to DB with processing_status='apollo_matched'
 *
 * Default ICP: United States + Canada; 10–50 employees; industries: Computer Software,
 * Marketing & Advertising, Retail.
 *
 * ENV: TARGET_COUNT, PERSON_TITLES, PERSON_LOCATIONS, ORGANIZATION_NUM_EMPLOYEES_RANGES,
 * ORGANIZATION_INDUSTRY_TAG_IDS (override), APOLLO_API_KEY, SUPABASE_DB_URL, BATCH_ID
 */

import { getDb, createPipelineRun, updatePipelineRun, createServiceExecution, updateServiceExecution, insertNewLeads } from '../../lib/supabase-pipeline.js';

// ── Filters: US/CA, 10–50 employees, 3 industries, verified emails only ─────

const PERSON_LOCATIONS = ['United States', 'Canada'];
const ORGANIZATION_LOCATIONS = ['United States', 'Canada'];
const ORGANIZATION_NUM_EMPLOYEES_RANGES = ['11,20', '21,50'];
const ORGANIZATION_INDUSTRY_TAG_IDS = ['5567cd4e7369643b70010000', '5567cd467369644d39040000', '5567ced173696450cb580000']; // Computer Software, Marketing & Advertising, Retail
const CONTACT_EMAIL_STATUS = ['verified'];

// ── Configuration ──────────────────────────────────────────────────

const TARGET_COUNT = parseInt(process.env.TARGET_COUNT || '100', 10);
const PERSON_TITLES = process.env.PERSON_TITLES ? JSON.parse(process.env.PERSON_TITLES) : ['vp marketing', 'head of marketing', 'vp sales', 'director of marketing', 'director of sales'];
const ORGANIZATION_INDUSTRY_TAG_IDS_FINAL = process.env.ORGANIZATION_INDUSTRY_TAG_IDS ? JSON.parse(process.env.ORGANIZATION_INDUSTRY_TAG_IDS) : ORGANIZATION_INDUSTRY_TAG_IDS;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const BATCH_ID = process.env.BATCH_ID || `apollo-${Date.now()}`;

if (!APOLLO_API_KEY) {
  console.error('❌ APOLLO_API_KEY not found in env');
  process.exit(1);
}

// ── Apollo API ─────────────────────────────────────────────────────

async function apolloSearchPeople(page: number = 1, perPage: number = 100): Promise<{ person_ids: string[]; total_pages: number; api_credits: number }> {
  const url = 'https://api.apollo.io/api/v1/mixed_people/api_search';

  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
    person_titles: PERSON_TITLES,
    person_locations: PERSON_LOCATIONS,
    organization_locations: ORGANIZATION_LOCATIONS,
    organization_num_employees_ranges: ORGANIZATION_NUM_EMPLOYEES_RANGES,
    contact_email_status_v2: CONTACT_EMAIL_STATUS
  };
  if (ORGANIZATION_INDUSTRY_TAG_IDS_FINAL.length > 0) {
    body.organization_industry_tag_ids = ORGANIZATION_INDUSTRY_TAG_IDS_FINAL;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `Apollo search failed: ${response.status} ${response.statusText}`;
    if (errBody) {
      try {
        const parsed = JSON.parse(errBody);
        errMsg += ` — ${JSON.stringify(parsed)}`;
      } catch {
        errMsg += ` — ${errBody.slice(0, 200)}`;
      }
    }
    throw new Error(errMsg);
  }

  const data = await response.json();

  return {
    person_ids: (data.people || []).map((p: any) => p.id),
    total_pages: data.pagination?.total_pages || 1,
    api_credits: data.breadcrumb?.total_results || 0
  };
}

async function apolloBulkMatch(personIds: string[]): Promise<any[]> {
  if (personIds.length === 0) return [];

  const url = 'https://api.apollo.io/api/v1/people/bulk_match';

  const body = {
    details: personIds.map(id => ({ id }))
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Apollo bulk match failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return (data.matches || []).map((match: any) => ({
    apollo_person_id: match.id,
    first_name: match.first_name ?? '',
    last_name: match.last_name ?? '',
    email: match.email,
    company_name: match.organization?.name ?? '',
    title: match.title ?? '',
    linkedin_url: match.linkedin_url,
    processing_status: 'apollo_matched',
    batch_id: BATCH_ID
  }));
}

// ── Main Service ───────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Apollo Service Starting`);
  console.log(`   Target: ${TARGET_COUNT} leads`);
  console.log(`   Titles: ${PERSON_TITLES.join(', ')}`);
  console.log(`   Person locations: ${PERSON_LOCATIONS.join(', ')}`);
  console.log(`   Company HQ: ${ORGANIZATION_LOCATIONS.join(', ')} | Employees: ${ORGANIZATION_NUM_EMPLOYEES_RANGES.join(', ')}`);
  if (ORGANIZATION_INDUSTRY_TAG_IDS.length > 0) {
    console.log(`   Industries: ${ORGANIZATION_INDUSTRY_TAG_IDS.length} tag(s)`);
  }
  console.log(`   Batch ID: ${BATCH_ID}\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  // Create pipeline run
  const runId = await createPipelineRun(db, {
    run_type: 'apollo_collection',
    target_count: TARGET_COUNT,
    triggered_by: 'manual',
    icp_filters: {
      person_titles: PERSON_TITLES,
      person_locations: PERSON_LOCATIONS,
      organization_locations: ORGANIZATION_LOCATIONS,
      organization_num_employees_ranges: ORGANIZATION_NUM_EMPLOYEES_RANGES,
      organization_industry_tag_ids: ORGANIZATION_INDUSTRY_TAG_IDS
    }
  });

  console.log(`📊 Pipeline run created: ${runId}\n`);

  let totalCollected = 0;
  let totalFailed = 0;
  let totalSkippedExisting = 0;
  let totalSkippedDuplicate = 0;
  let currentPage = 1;
  let apiCallsMade = 0;
  let apiErrors = 0;

  try {
    while (totalCollected < TARGET_COUNT) {
      // Step 1: Search for person IDs (per_page = min(100, remaining needed))
      const remaining = TARGET_COUNT - totalCollected;
      const perPage = Math.min(100, Math.max(1, remaining));
      console.log(`🔍 Searching page ${currentPage} (per_page=${perPage}, need ${remaining} more)...`);

      const execSearchId = await createServiceExecution(db, {
        pipeline_run_id: runId,
        service_name: 'apollo',
        status: 'running',
        batch_size: perPage
      });

      let searchResult;
      try {
        searchResult = await apolloSearchPeople(currentPage, perPage);
        apiCallsMade++;

        console.log(`   ✅ Found ${searchResult.person_ids.length} person IDs`);
      } catch (error: any) {
        apiErrors++;
        console.error(`   ❌ Search failed: ${error.message}`);

        await updateServiceExecution(db, execSearchId, {
          status: 'failed',
          completed_at: new Date(),
          api_errors: 1,
          error_message: error.message
        });

        if (error.message.includes('429')) {
          console.log('   ⏸️  Rate limit hit, pausing 60 seconds...\n');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        } else {
          break;
        }
      }

      if (searchResult.person_ids.length === 0) {
        console.log('   ℹ️  No more results from Apollo\n');
        await updateServiceExecution(db, execSearchId, {
          status: 'completed',
          completed_at: new Date(),
          output_count: 0,
          api_calls_made: 1
        });
        break;
      }

      // Step 2: Bulk match in batches of 10 (stop early when we have enough)
      const matchBatchSize = 10;
      const neededForTarget = TARGET_COUNT - totalCollected;
      let pageLeads: any[] = [];

      for (let i = 0; i < searchResult.person_ids.length; i += matchBatchSize) {
        if (pageLeads.length >= neededForTarget) break;

        const batch = searchResult.person_ids.slice(i, i + matchBatchSize);

        console.log(`   🔗 Matching batch ${Math.floor(i / matchBatchSize) + 1} (${batch.length} IDs)...`);

        const execMatchId = await createServiceExecution(db, {
          pipeline_run_id: runId,
          service_name: 'apollo',
          status: 'running',
          input_count: batch.length,
          batch_size: matchBatchSize
        });

        try {
          const leads = await apolloBulkMatch(batch);
          apiCallsMade++;

          pageLeads.push(...leads);
          console.log(`      ✅ Matched ${leads.length} leads with emails`);

          await updateServiceExecution(db, execMatchId, {
            status: 'completed',
            completed_at: new Date(),
            output_count: leads.length,
            failed_count: batch.length - leads.length,
            api_calls_made: 1
          });

        } catch (error: any) {
          apiErrors++;
          console.error(`      ❌ Match failed: ${error.message}`);

          await updateServiceExecution(db, execMatchId, {
            status: 'failed',
            completed_at: new Date(),
            api_errors: 1,
            error_message: error.message
          });

          if (error.message.includes('429')) {
            console.log('      ⏸️  Rate limit hit, pausing 60 seconds...\n');
            await new Promise(resolve => setTimeout(resolve, 60000));
            i -= matchBatchSize; // Retry this batch
            continue;
          }
        }

        // Small delay between match batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Step 3: Dedupe by email, skip existing, save only NEW leads
      if (pageLeads.length > 0) {
        const seen = new Set<string>();
        const deduped = pageLeads.filter((l) => {
          const e = (l.email || '').trim().toLowerCase();
          if (!e || seen.has(e)) return false;
          seen.add(e);
          return true;
        });
        const dupCount = pageLeads.length - deduped.length;
        totalSkippedDuplicate += dupCount;
        if (dupCount > 0) {
          console.log(`   ⚠️  Deduped ${dupCount} duplicate email(s) in batch`);
        }

        const needed = TARGET_COUNT - totalCollected;
        const toSave = deduped.slice(0, needed);
        const result = await insertNewLeads(db, toSave, { batchId: BATCH_ID });
        totalCollected += result.inserted;
        totalSkippedExisting += result.skippedExisting;

        console.log(`   💾 Inserted ${result.inserted} new | Skipped ${result.skippedExisting} existing (total new: ${totalCollected}/${TARGET_COUNT})`);
      }

      await updateServiceExecution(db, execSearchId, {
        status: 'completed',
        completed_at: new Date(),
        output_count: pageLeads.length,
        api_calls_made: 1
      });

      console.log(`   📊 Progress: ${totalCollected}/${TARGET_COUNT} (${Math.round(totalCollected / TARGET_COUNT * 100)}%)\n`);

      // Check if we've reached target
      if (totalCollected >= TARGET_COUNT) {
        console.log(`✅ Target reached! Collected ${totalCollected} leads.\n`);
        break;
      }

      currentPage++;

      // Delay between pages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update pipeline run
    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalCollected,
      leads_succeeded: totalCollected,
      leads_failed: totalFailed
    });

    console.log(`\n✅ Apollo Service Complete`);
    console.log(`   New leads inserted: ${totalCollected}`);
    console.log(`   Skipped (already in DB): ${totalSkippedExisting}`);
    console.log(`   Skipped (duplicate email in batch): ${totalSkippedDuplicate}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}`);
    console.log(`   Status: apollo_matched`);
    console.log(`   Batch ID: ${BATCH_ID}\n`);

  } catch (error: any) {
    console.error(`\n❌ Apollo Service Failed: ${error.message}\n`);

    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      leads_processed: totalCollected,
      leads_succeeded: totalCollected,
      leads_failed: totalFailed,
      error_message: error.message
    });

    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
