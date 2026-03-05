export type RagSourcePresetId =
  | "rag.source.market_hot"
  | "rag.source.community_hot"
  | "rag.source.news_headlines"
  | "rag.source.sns_trends";

export type RagSourcePreset = {
  id: RagSourcePresetId;
  label: string;
  keywords: string;
  countries: string;
  sites: string;
  maxItems: number;
};

export const RAG_SOURCE_PRESETS: RagSourcePreset[] = [
  {
    id: "rag.source.market_hot",
    label: "마켓 핫토픽",
    keywords: "stock market, earnings, fed, inflation, semiconductor",
    countries: "US,JP,CN,KR",
    sites: "finance.yahoo.com, marketwatch.com, reuters.com, naver.com",
    maxItems: 48,
  },
  {
    id: "rag.source.community_hot",
    label: "커뮤니티 핫토픽",
    keywords: "indie game, unity, steam, ai tool, startup",
    countries: "US,JP,CN,KR",
    sites: "reddit.com, clien.net, v2ex.com, dcinside.com",
    maxItems: 50,
  },
  {
    id: "rag.source.news_headlines",
    label: "뉴스 헤드라인",
    keywords: "breaking news, top stories, trend, economy, technology",
    countries: "US,JP,CN,KR",
    sites: "reuters.com, bloomberg.com, naver.com, nhk.or.jp",
    maxItems: 44,
  },
  {
    id: "rag.source.sns_trends",
    label: "SNS 트렌드",
    keywords: "trending, viral, meme, x trend, threads trend",
    countries: "US,JP,CN,KR",
    sites: "x.com, threads.com, reddit.com",
    maxItems: 42,
  },
];
