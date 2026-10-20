"""Build offline typing lessons from the user's MathorCup PDFs and original IELTS essays.

Runtime has no third-party requirements. Only rebuilding the Chinese corpus needs PyMuPDF.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
from ielts_material import ESSAYS
from backend.text_rules import practice_text

TERMS = "数据预处理 数据清洗 缺失值 异常值 标准化 归一化 特征工程 特征提取 特征选择 主成分分析 聚类分析 相关性分析 回归分析 多元线性回归 逻辑回归 随机森林 决策树 支持向量机 神经网络 深度学习 机器学习 集成学习 时间序列 指数平滑 灰色预测 预测模型 目标函数 约束条件 最优解 线性规划 整数规划 动态规划 遗传算法 模拟退火 粒子群算法 蚁群算法 数学模型 模型假设 模型建立 模型求解 模型检验 模型评价 灵敏度分析 稳定性分析 鲁棒性 交叉验证 训练集 测试集 验证集 均方误差 均方根误差 平均绝对误差 决定系数 置信区间 评价指标 层次分析法 熵权法 综合评价 正态分布 概率分布 参数估计 显著性检验 假设检验 拟合优度 最小二乘法 损失函数 优化算法 数据分析 数据挖掘 数据处理 数据集 可视化 散点图 箱线图 直方图 热力图 特征变量 解释变量 因变量 自变量 权重系数 矩阵 运筹学 供应链 库存管理 路径规划 物流配送 运输成本 调度方案 生产效率 资源配置 需求预测 销售预测 预测精度 误差分析 非线性 线性关系 影响因素 统计分析 描述性统计 统计特征 离散程度 变化趋势 最优方案 实际问题 问题分析 问题重述 建模思路 研究结果 实验结果 算法实现 模型改进 模型推广 数据来源 研究对象 目标变量 样本数据 历史数据 原始数据 特征重要性 分类模型 回归模型 聚类模型 组合模型 梯度提升 数据分布 样本数量 空间分布 时间分布 相关系数 数据特征 预测结果 评价体系".split()


def tidy(text):
    text = re.sub(r"[\s\u3000\u00a0]+", "", text)
    text = text.replace("\ufffd", "")
    return text


def acceptable(text, minimum=30, maximum=420):
    if not minimum <= len(text) <= maximum:
        return False
    han = len(re.findall(r"[\u4e00-\u9fff]", text))
    allowed = len(re.findall(r"[\u4e00-\u9fff，。；：、！？（）“”《》—…\-A-Za-z0-9.,%+()：]", text))
    return han / len(text) >= .78 and allowed / len(text) >= .98 and not re.search(r"[=<>∑∈∂αβλμ]|\.{3}|代码|参考文献|致谢|承诺", text)


def build_chinese(source_root):
    import fitz
    files = sorted(p for p in source_root.rglob("*.pdf") if "优秀论文" in str(p))
    sources, pages, sentences, paragraphs = [], [], [], []
    seen_s, seen_p = set(), set()
    for path in files:
        relative = path.relative_to(source_root).as_posix()
        source_id = hashlib.sha256(relative.encode()).hexdigest()[:12]
        with fitz.open(path) as doc:
            sources.append({"id": source_id, "file": relative, "title": path.stem, "pages": len(doc), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            for page_no, page in enumerate(doc, 1):
                whole = tidy(page.get_text())
                pages.append((whole, source_id, page_no))
                page_s = []
                for block in page.get_text("blocks", sort=True):
                    if block[6] != 0:
                        continue
                    text = tidy(block[4])
                    # Only take complete prose, dropping page headings and formula fragments.
                    chunks = re.findall(r"[^。！？]*[。！？]", text)
                    valid = []
                    for chunk in chunks:
                        chunk = re.sub(r"^[\d.、（）]+", "", chunk)
                        if acceptable(chunk, 30, 135):
                            valid.append(chunk)
                            if chunk not in seen_s:
                                seen_s.add(chunk)
                                page_s.append({"text": chunk, "sourceId": source_id, "page": page_no})
                    combined = ""
                    for raw_chunk in chunks:
                        if not acceptable(raw_chunk, 10, 300):
                            combined = ""
                            continue
                        combined = raw_chunk if len(combined + raw_chunk) > 360 else combined + raw_chunk
                        if acceptable(combined, 150, 360) and combined not in seen_p:
                            seen_p.add(combined)
                            paragraphs.append({"text": combined, "sourceId": source_id, "page": page_no})
                            break
                sentences.extend(page_s[:3])
    phrases = []
    for term in TERMS:
        match = next(((sid, page) for text, sid, page in pages if term in text), None)
        if match:
            phrases.append({"text": term, "sourceId": match[0], "page": match[1]})
    # Distribute chosen lessons across papers rather than exhausting the first paper.
    def diverse(items, limit):
        buckets = {}
        for item in items:
            buckets.setdefault(item["sourceId"], []).append(item)
        chosen = []
        while len(chosen) < limit and any(buckets.values()):
            for bucket in buckets.values():
                if bucket and len(chosen) < limit:
                    chosen.append(bucket.pop(0))
        return sorted(chosen, key=lambda x: len(x["text"]))
    return sources, phrases, diverse(sentences, 30), diverse(paragraphs, 20)


def lesson(lang, kind, index, title, text, **extra):
    tier = min(index // 6, 3)
    targets = {"en": [18, 25, 32, 40], "zh": [12, 18, 25, 32]}
    text = practice_text(text, kind)
    return {"id": f"{lang}-{kind}-{index + 1:02}", "language": lang, "kind": kind,
            "order": index + 1, "title": title, "text": text, "tier": tier,
            "targetSpeed": targets[lang][tier], "targetAccuracy": [90, 93, 95, 96][tier], **extra}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(r"C:\Users\Administrator\Desktop\MathorCup"))
    args = parser.parse_args()
    sources, phrases, sentences, paragraphs = build_chinese(args.source)
    lessons = []
    for i in range(0, len(phrases), 5):
        group = phrases[i:i + 5]
        lessons.append(lesson("zh", "phrase", i // 5, f"建模词组 · {i // 5 + 1:02}", " ".join(x["text"] for x in group), references=group, topic="数学建模术语", sourceLabel="MathorCup 优秀论文 · 原文词组"))
    for kind, items in [("sentence", sentences), ("article", paragraphs)]:
        for i, item in enumerate(items):
            lessons.append(lesson("zh", kind, i, f"{'论文句子' if kind == 'sentence' else '论文节选'} · {i + 1:02}", item["text"], references=[{k: v for k, v in item.items() if k != 'text'}], topic="数学建模论文", sourceLabel="MathorCup 优秀论文 · 正文节选"))
    for i, essay in enumerate(ESSAYS):
        label = "IELTS Writing Task 2 · 原创主题范文"
        lessons.append(lesson("en", "article", i, essay["title"], essay["text"], topic=essay["topic"], sourceLabel=label, prompt=essay["prompt"], translation=essay["translation"]))
        for half in range(2):
            group = essay["phrases"][half * 4:(half + 1) * 4]
            lessons.append(lesson("en", "phrase", i * 2 + half, f"{essay['topic']} · 核心表达 {half + 1}", " / ".join(x[0] for x in group), topic=essay["topic"], sourceLabel=label, translation="；".join(x[1] for x in group)))
            sents = re.split(r"(?<=[.!?])\s+", essay["text"])
            chosen = sents[half * 2:half * 2 + 2]
            lessons.append(lesson("en", "sentence", i * 2 + half, f"{essay['topic']} · 写作句型 {half + 1}", " ".join(chosen), topic=essay["topic"], sourceLabel=label))
    # Every lane progresses through four tiers, including the shorter essay lane.
    for language in ["en", "zh"]:
        for kind in ["phrase", "sentence", "article"]:
            lane = sorted([x for x in lessons if x["language"] == language and x["kind"] == kind], key=lambda x: x["order"])
            for index, item in enumerate(lane):
                tier = min(index * 4 // len(lane), 3)
                item.update(tier=tier, targetSpeed=({"en": [8, 12, 16, 20], "zh": [6, 8, 10, 12]}[language][tier]), targetAccuracy=[75, 80, 82, 85][tier])
    out = {"version": 1, "chineseSourceRoot": str(args.source), "sources": sources, "lessons": lessons,
           "notes": ["中文正文由本机优秀论文 PDF 提取，词组逐一核对原文；仅词组练习将标点替换为空格，句子与文章保留原有标点。", "中文文章练习为同一页连续正文节选，并非整篇论文。", "英文为雅思 Task 2 常见主题原创练习范文，不代表官方真题范文或评分。", "宽松鼓励模式：更正后恢复正确率，完成全文有60分基础分。"]}
    destination = ROOT / "data" / "corpus.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"papers": len(sources), "lessons": len(lessons), "by_track": {f"{l}-{k}": sum(x['language'] == l and x['kind'] == k for x in lessons) for l in ['en','zh'] for k in ['phrase','sentence','article']}}, ensure_ascii=True))


if __name__ == "__main__":
    main()
