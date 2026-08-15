const BASE_URL = "https://api.planningcenteronline.com/services/v2";

function authHeader() {
  const appId = process.env.PCO_APP_ID;
  const secret = process.env.PCO_SECRET;
  if (!appId || !secret) {
    throw new Error(
      "Missing PCO_APP_ID or PCO_SECRET environment variables. Set them in Render's dashboard."
    );
  }
  const token = Buffer.from(`${appId}:${secret}`).toString("base64");
  return `Basic ${token}`;
}

async function pcoFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Planning Center API error ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 500)}`
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function listServiceTypes() {
  const data = await pcoFetch("/service_types?per_page=100");
  return data.data.map((st) => ({
    id: st.id,
    name: st.attributes.name,
  }));
}

export async function listPlans(serviceTypeId, { onlyFuture = true } = {}) {
  const filter = onlyFuture ? "&filter=future" : "";
  const data = await pcoFetch(
    `/service_types/${serviceTypeId}/plans?per_page=25&order=sort_date${filter}`
  );
  return data.data.map((p) => ({
    id: p.id,
    title: p.attributes.title,
    dates: p.attributes.dates,
    sort_date: p.attributes.sort_date,
    series_title: p.attributes.series_title,
  }));
}

export async function getPlan(serviceTypeId, planId) {
  const data = await pcoFetch(`/service_types/${serviceTypeId}/plans/${planId}`);
  const p = data.data;
  return {
    id: p.id,
    title: p.attributes.title,
    dates: p.attributes.dates,
    sort_date: p.attributes.sort_date,
    series_title: p.attributes.series_title,
  };
}

export async function getPlanItems(serviceTypeId, planId) {
  const data = await pcoFetch(
    `/service_types/${serviceTypeId}/plans/${planId}/items?per_page=200&include=song`
  );

  const songsById = {};
  for (const inc of data.included || []) {
    if (inc.type === "Song") {
      songsById[inc.id] = {
        title: inc.attributes.title,
        author: inc.attributes.author,
      };
    }
  }

  return data.data.map((item) => {
    const songRel = item.relationships?.song?.data;
    const song = songRel ? songsById[songRel.id] : null;
    return {
      id: item.id,
      sequence: item.attributes.sequence,
      title: item.attributes.title,
      item_type: item.attributes.item_type,
      length_seconds: item.attributes.length,
      description: item.attributes.description,
      song,
    };
  });
}

export async function createPlanItem(serviceTypeId, planId, { title, itemType = "item", sequence }) {
  const body = {
    data: {
      type: "Item",
      attributes: {
        title,
        item_type: itemType,
        ...(sequence !== undefined ? { sequence } : {}),
      },
    },
  };
  const data = await pcoFetch(`/service_types/${serviceTypeId}/plans/${planId}/items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: data.data.id, title: data.data.attributes.title };
}
