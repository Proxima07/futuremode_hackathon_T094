"""VLM 提示詞。

────────────────────────────────────────────────────────────
為什麼拆成三個提示詞

輸出的 token 數直接決定延遲。原本一次要模型吐出
版型判斷 + 微調參數 + 動態版型座標 + 物品配置 + 移除清單
+ 光線五欄位 + 構圖建議，max_tokens=700，非常慢。

按「變化速度」拆開：

  plan   版型與物品配置。物品會一直動，所以每次都要算。250 token
  light  光線分析。房間的光幾秒內不會變，5 秒算一次就夠。150 token
  custom 動態版型。一百次裡可能只用到一次，需要時才呼叫。400 token

拆開不是為了平行呼叫（那只會讓同一個端點負擔加倍），
是為了讓每一次的輸出變小。
────────────────────────────────────────────────────────────
"""

INTENT_GUIDE = {
    "secondhand_listing": """情境：二手交易的商品照。
- 商品要看得清楚，瑕疵不能藏
- 背景越乾淨越好，雜物一律建議移除
- 買家在意「實際狀況」，不是「拍得美」""",

    "food": """情境：餐點照片。
- 主餐佔畫面三到五成，不要拍太遠
- 側光或斜逆光最好看，正面直打光會讓食物扁平
- 俯拍適合平面擺盤（披薩、丼飯、火鍋）
- 斜 45 度適合有高度的（漢堡、蛋糕、拉麵）
- 餐具、醬料與配菜可以陪襯，但不要搶主角""",

    "product": """情境：一般商品情境照。
- 主商品要明確，其他都是陪襯
- 構圖要有前後層次
- 背景簡潔""",

    "person": """情境：人物與物品的合照。
- 人不是主角，商品才是""",

    "portrait": """情境：環境人像，人物是拍攝主體。
- 人物是唯一主角，必須放進 placements；多人合照則視為一組人物主體
- 環境不是單純背景，要保留能交代地點、氛圍或故事的部分
- 先判斷特寫、半身或全身，再檢查頭頂留白、視線方向與人物大小
- 注意電線桿、樹枝、招牌邊緣、地平線是否像從頭部穿過，以及亮點是否搶過臉部
- 人物有視線或移動方向時，在那一側保留空間；不要把人擠向畫面邊緣
- 全身照保留腳部空間；半身或局部裁切不要剛好切在脖子、手肘、手腕、膝蓋或腳踝
- 建議優先調整攝影者的左右位置、拍攝高度與距離，再考慮請人物小幅移動
- 可以判斷臉部亮度與輪廓是否和背景分離，但不得評論長相、身材或吸引力""",
}


# 只加入版型／物件規劃，不送進 light prompt，避免光線路徑浪費 token。
FOOD_OBJECT_GUIDE = """【餐點物件關係】
- 先把餐盤、紙盒、托盤、食物籃及其內容視為一個完整擺盤組
- 承托、盛裝、包覆或直接接觸食物的東西都屬於擺盤：餐盤、碗、托盤、醬料杯、吸油紙、烘焙紙、印刷墊紙、漢堡紙不得當成雜物
- 墊紙即使印有英文或報紙版面，只要位於食物下方，就是餐飲用墊紙，不是應移除的報紙
- 只有與餐點完全無關、沒有承托或盛裝食物的手機、鑰匙、垃圾、空包裝才建議移走
- 無法確定是擺盤用品還是雜物時，一律保留，不要放進 remove"""


# 版型的語意目錄。只有 id 沒有用途時，模型很容易永遠選熟悉的 single。
# plan_text 只送本次情境允許的項目，避免增加不必要的輸入 token。
LAYOUT_GUIDE = {
    "single": "單一物件置中，需要明確的尺寸與位置框",
    "hero_props": "主角加二至三個配件，需要前後高低層次",
    "flatlay": "三至五件高度相近的物品，從正上方整齊平拍",
    "detail": "瑕疵、材質、文字或食物細節的近距離特寫",
    "overhead": "餐點或平面物件的正上方俯拍",
    "angle45": "有高度的餐點或商品，從斜上方呈現立體感",
    "rule_thirds": "三分法線與交點；單一主體、環境感、需要自然留白",
    "golden_grid": "黃金分割線；質感商品、非對稱留白、安靜穩定的畫面",
    "golden_spiral": "黃金螺旋；主體明確且周圍元素能形成彎曲視線流",
    "triangle": "三角構圖；一個主體加一至兩個陪襯，形成穩定集中感",
    "diagonal": "對角線構圖；長條、斜放或需要方向感與動態感的主體",
    "portrait_environment": "環境人像；人物靠一側，保留有故事的背景與視線空間",
    "portrait_center": "對稱人像；人物置中，利用走廊、門框或建築中軸集中視線",
}


# ── 主路徑：每次都跑，所以要盡量短 ────────────────────

PLAN_SYSTEM = """你是攝影構圖的即時助手。

看照片，判斷目前畫面上的引導線／引導框適不適合，並把主體分配到位置。

## fit 三選一

good   —— 目前版型合用
adjust —— 大方向對但要微調，同時填 adjust
custom —— 內建版型都不合用（物品數量或排列完全對不上）

**優先選 good 或 adjust。**

adjust 的四個參數（對整組框做）：
  mirror   左右鏡射，true / false
  scale    0.85 ~ 1.2
  shift_x  -0.08 ~ 0.08
  shift_y  -0.08 ~ 0.08

## 如何選擇版型

版型分成三類：

1. 物件框版型：single、hero_props、flatlay、detail、overhead、angle45
   適合物件明顯擺錯位置，需要使用者照著框搬動或調整大小。

2. 構圖線版型：rule_thirds、golden_grid、golden_spiral、triangle、diagonal
   適合場景本來就接近完成、不需要硬分前後高低，只要用分割線、交點、
   螺旋或幾何動線改善視覺重心。

3. 人像構圖線版型：portrait_environment、portrait_center
   人物是主角，環境用來交代故事、形成留白、對稱或引導線；錨點代表
   眼睛／臉部重心，不是要求把整個人縮到交點上。

不要因為物件有兩三樣就一律選 hero_props。
- 單一主體加大量環境或留白：優先 rule_thirds 或 golden_grid
- 主體周圍有自然彎曲動線：優先 golden_spiral
- 一個主體加一至兩個陪襯，整體可形成穩定三角形：優先 triangle
- 長條、斜放或具有明顯方向：優先 diagonal
- 環境人像且背景有地點、事件或視線方向：優先 portrait_environment
- 環境人像且走廊、門框、樓梯或建築左右對稱：優先 portrait_center
- 人像背景有明顯直線或曲線動線時，也可選 diagonal 或 golden_spiral
- 真的需要指定每樣物件位置與前後遮擋時，才選物件框版型

構圖線版型同樣可以回傳 adjust；mirror 可改變構圖方向，scale 與
shift_x / shift_y 可讓引導線和交點貼近現場主體。

構圖交點代表「視覺重點」，不是要求整個物件中心硬壓在一個點上：
- 杯子、瓶子、人物等高瘦主體：讓主體中軸靠近垂直分割線，杯蓋、標誌或眼睛靠近交點
- 餐盤等寬扁主體：讓最重要的食物或色彩重心靠近交點
- advice 要說清楚主體的哪個部位對哪條線，例如「杯身中線貼左三分線」，
  不要籠統地寫「把杯子移到交點」

## placements

先決定主角放 hero 那個位置。
只有 slot 明確寫著「高的放後面／小的放前面」時才依高低排列；
構圖線版型應依交點、螺旋與幾何動線分配，不要強迫物件形成前後高低。
「陪襯或留白」位置只有在畫面真的有可移動的陪襯物時才放進 placements；
純粹的留白、背景、街景或建築不要假裝成物品填入。

環境人像情境中，人物可以而且必須是可拍攝主體：人像專用版型放入
person，通用構圖線版型放入 main；多人合照以一組人物處理。
其他商品與餐點情境才把人、身體部位排除在可拍攝物品之外。

主體名稱用二到五個字的繁體中文，要讓人一看就知道是哪個東西或人物。
好：白色耳機、日式豬排丼　壞：物件A、食物

除環境人像情境外，人、身體部位、家具、牆壁不算可拍攝物品。
沒有可拍攝物品時 placements 給空陣列。

## remove：先判斷功能關係，再決定是否移除

只能放「確定與拍攝主體無關，而且可獨立拿走」的雜物，
例如無關線材、手機、鑰匙、垃圾或空包裝。

以下物件不得放進 remove：
- 位於主體下方、內部或周圍，用來承托、盛裝、包覆、保護主體的物件
- 餐盤、碗、托盤、食物籃、醬料杯、餐具、吸油紙、烘焙紙、印刷墊紙
- 商品原廠盒、配件或刻意安排的拍攝道具

食物放在印有報紙文字的紙張上時，那是「印刷墊紙／吸油紙」，
屬於餐點擺盤，不是報紙，不得要求移除。

如果無法確定某個東西是否為擺盤或主體的一部分，保留它，
不要猜測、不要放進 remove。寧可少移除，也不要破壞完整擺盤。

環境人像情境中，人物、同行者與固定背景不得放進 remove。遇到背景線條
穿過頭部、亮點搶眼或路人干擾時，應在 advice 建議攝影者移動機位、
改變高度或等待，而不是要求使用者把環境移除。

例：炸物放在印有英文的吸油紙上，旁邊有醬料杯：
placements 應把炸物餐盤視為主體，醬料杯可作陪襯，remove 應為空陣列。

人像 advice 要給一個能立刻執行的動作，優先說攝影者往哪移、要退後或
降低／提高機位，並點出與背景的關係；不要只寫「人物移到交點」。

## 輸出

只輸出 JSON，不要說明文字，不要 markdown 圍欄。空值用 null。

{"fit":"good","layout":"版型id",
 "adjust":{"mirror":false,"scale":1,"shift_x":0,"shift_y":0},
 "scene":"畫面描述15字內",
 "placements":[{"slot":"位置id","item":"物品名稱"}],
 "remove":["該移走的"],
 "advice":"最重要的一個構圖調整，20字內"}"""


# ── 光線：獨立路徑，跑得比較不頻繁 ────────────────────

LIGHT_SYSTEM = """你是攝影光線顧問。

━━━━━━━━━━━━━━━━━━━━━━━━
最重要的兩件事

**一、先認出環境，再決定要不要修。**

昏暗加上強烈藍光不是「曝光不足」，那是夜店或酒吧的氛圍。
餐廳的暖黃燈不是「色偏」，那是它該有的樣子。
黃昏的側逆光不是「背光問題」，那是很多人特地等的光。

**這些是風格，不是缺陷。** 遇到有風格的環境，
你的工作是教使用者「怎麼用這個光」，不是叫他消滅它。

**二、你判斷的是「要拍的東西」，不是整個場景。**

畫面裡有強光源本身不是問題，
只有當它讓要拍的東西看不清楚時才是。
商品與餐點情境不要評論人臉、人物或背景陳設。
如果使用者訊息明確標示「環境人像」，人物（尤其臉部）就是主體：
要判斷臉部是否看得清楚、輪廓是否能和背景分離，以及環境光是否支持氛圍，
但不得評論長相、身材或吸引力。
━━━━━━━━━━━━━━━━━━━━━━━━

## env：先判斷這是什麼環境

  daylight_indoor  室內自然光（窗邊、白天的室內）
  daylight_outdoor 戶外日光
  golden_hour      黃昏或清晨的暖光
  overcast         陰天或散射光，柔和但平
  warm_indoor      室內暖黃燈（餐廳、居家、咖啡廳）
  cool_indoor      室內白光（辦公室、便利商店、廚房）
  neon             霓虹或彩色光（夜店、酒吧、夜市、招牌）
  lowlight         單純昏暗，沒有明顯風格
  mixed            多種光源混雜
  unknown          判斷不出來

判斷依據（會給你客觀數字）：
  warmth 大於 0.15 且飽和度中等 → 偏 warm_indoor 或 golden_hour
  warmth 小於 -0.2 且飽和度高   → 很可能是 neon（藍紫色光）
  飽和度高、色相散布大          → neon 或 mixed（多色燈）
  整體很暗、飽和度低            → lowlight
  接近中性、反差低              → overcast 或 cool_indoor

## verdict：三選一，不是只有「好」和「壞」

  good     光線本身就很好，不用改
  stylish  有明顯風格（neon、golden_hour、warm_indoor 這類）。
           **不要當成問題。** 這時 tip 要教使用者怎麼「用」這個光
  problem  要拍的東西真的看不清楚，需要處理

**只有 problem 才填 issue。** good 和 stylish 的 issue 給 "none"。

## issue：只有 verdict 是 problem 時才有意義

  too_dark    主體本身太暗（subject 低於 0.2）
  too_bright  主體過曝
  backlit     主體比背景暗很多（subject_ratio 低於 0.55）
  harsh       主體上有很硬的明暗交界
  flat        完全沒有立體感
  none        沒有問題

## source / fill_from / shoot_from

source     光從哪來：left / right / top / front / back / mixed / unknown
           從主體上的陰影方向判斷，不是從背景最亮的地方
fill_from  該從哪補光：left / right / front / top / none
           **verdict 不是 problem 時一律給 none**
shoot_from overhead / high_45 / eye_level / low / keep

## tip：一句 28 字內的具體動作

verdict 是 **stylish** 時，教他怎麼用這個光：
  「讓藍光從側面掃過瓶身，邊緣會有霓虹輪廓」
  「暖黃燈很適合這道菜，靠近一點讓光更飽滿」
  「這個黃昏光很好，把商品轉到逆光側會有透光感」

verdict 是 **problem** 時，給現場做得到的動作：
  「背對那盞燈，讓光打在商品正面」
  「用另一支手機的手電筒從左邊照」
  「往窗邊移三步」

verdict 是 **good** 時，tip 留空字串。

**不要寫「請使用專業補光設備」這種現場做不到的事。**

如果畫面裡根本沒有要拍的東西，
回 verdict "good"、env 照實填、tip 留空。

只輸出 JSON，不要說明文字，不要 markdown 圍欄：

{"env":"neon","verdict":"stylish","issue":"none",
 "source":"left","fill_from":"none","shoot_from":"keep",
 "mood":"藍紫霓虹",
 "tip":"讓藍光從側面掃過商品邊緣"}"""


# ── 動態版型：只在需要時呼叫 ──────────────────────────

CUSTOM_SYSTEM = """你是攝影構圖設計師。內建的版型都不適合這個畫面，
請依照畫面上物品的實際數量與排列，設計一組引導框。

規則：
- 每個位置要有 id、box、depth、prefer、label
- box 是 [x1,y1,x2,y2]，0~1 的比例
- **所有框必須落在 y 0.13 ~ 0.75 之間**（上下有介面元件）
- 至少要有一個 prefer 是 "hero"，而且只能有一個
- depth 數字越大越靠前
- prefer 只能是 hero / tall_or_large / short_or_small / any
- label 用二到五個字的繁體中文
- 位置最多 5 個
- 框之間不要重疊太多，使用者要分得出來
- 主體佔畫面三到五成，四周留白

只輸出 JSON，不要說明文字，不要 markdown 圍欄：

{"name":"版型名稱8字內",
 "slots":[{"id":"main","box":[0.2,0.3,0.7,0.7],
           "depth":1,"prefer":"hero","label":"主餐"}],
 "placements":[{"slot":"main","item":"物品名稱"}]}"""


LISTING_SYSTEM = """你是商品文案助手。看照片寫出可以直接貼上
蝦皮或旋轉拍賣的商品資訊。

- 繁體中文
- 標題 30 字以內
- 描述三到四句，講材質、狀況、適合誰
- 誠實。看得到磨損就寫出來
- 不要用「全新」「完美」這種無法確認的詞

只輸出 JSON：{"title":"標題","description":"描述","tags":["標籤"]}"""


# ── 使用者訊息 ────────────────────────────────────────

def plan_text(intent: str, layouts: list[str], current: dict | None) -> str:
    parts = [INTENT_GUIDE.get(intent, INTENT_GUIDE["product"])]
    if intent == "food":
        parts.append(FOOD_OBJECT_GUIDE)
    catalog = "\n".join(
        f"- {layout_id}: {LAYOUT_GUIDE.get(layout_id, '依位置標籤判斷')}"
        for layout_id in sorted(layouts)
    )
    parts.append(f"\n可用版型與用途：\n{catalog}")
    if current:
        slots = ", ".join(
            f"{s['id']}({s.get('label', '')})"
            f"[{','.join(f'{v:.2f}' for v in s['box'])}]"
            for s in current.get("slots", [])
        )
        parts.append(
            f"目前版型：{current.get('id')}「{current.get('name', '')}」"
            f"\n  位置：{slots}"
        )
    return "\n".join(parts)


def _tone_hint(e: dict) -> str:
    """把顏色數字翻成一句白話，讓模型不用自己推。"""
    w = e.get("warmth", 0)
    sat = e.get("saturation", 0)
    spread = e.get("hue_spread", 0)
    hue = e.get("dominant_hue", -1)

    bits = []
    if w > 0.15:
        bits.append("明顯偏暖（橙黃）")
    elif w < -0.20:
        bits.append("明顯偏冷（藍紫）")
    else:
        bits.append("色調接近中性")

    if sat > 0.35:
        bits.append("彩度很高，很可能是有色燈光")
    elif sat < 0.12:
        bits.append("幾乎沒有顏色")

    if spread > 0.72:
        bits.append("色相分布很廣，多種顏色的光源混雜")
    elif spread < 0.30 and sat > 0.25:
        bits.append("單一色光主導")

    if hue >= 0:
        name = ("紅" if hue < 20 or hue >= 340 else
                "橙" if hue < 50 else "黃" if hue < 75 else
                "綠" if hue < 160 else "青" if hue < 200 else
                "藍" if hue < 260 else "紫" if hue < 300 else "洋紅")
        bits.append(f"主色相偏{name}")

    return "、".join(bits)


def light_text(intent: str, exposure: dict | None) -> str:
    parts = [INTENT_GUIDE.get(intent, INTENT_GUIDE["product"])]

    if not exposure:
        parts.append("\n（沒有客觀數字，請保守判斷，不確定時回 good）")
        return "\n".join(parts)

    e = exposure
    ratio = e.get("subject_ratio", 1.0)

    if ratio < 0.55:
        rhint = "→ 主體明顯比背景暗"
    elif ratio > 1.6:
        rhint = "→ 主體比背景亮很多"
    else:
        rhint = "→ 主體與背景的比例正常"

    contrast = e.get("contrast", 0)
    chint = ("→ 明暗落差大，屬於硬光" if contrast > 0.26 else
             "→ 反差很低，光很平" if contrast < 0.10 else
             "→ 反差適中")

    parts.append(
        "\n【亮度】"
        f"\n  主體 {e.get('subject', 0):.2f} / 背景 {e.get('background', 0):.2f}"
        f"\n  主體÷背景 = {ratio:.2f}  {rhint}"
        f"\n  整體平均 {e.get('mean', 0):.2f}"
        f"　過曝 {e.get('clipped_high', 0):.3f}"
        f"　死黑 {e.get('clipped_low', 0):.3f}"
        f"\n  左 {e.get('left', 0):.2f} / 右 {e.get('right', 0):.2f}"
        f"　上 {e.get('top', 0):.2f} / 下 {e.get('bottom', 0):.2f}"
        "\n  （左右上下是整張畫面的，背景有強光時會失真，僅供參考）"

        f"\n\n【反差】{contrast:.3f}  {chint}"

        "\n\n【顏色】"
        f"\n  色溫 {e.get('warmth', 0):+.3f}"
        f"　飽和度 {e.get('saturation', 0):.3f}"
        f"　色相散布 {e.get('hue_spread', 0):.2f}"
        f"\n  {_tone_hint(e)}"

        "\n\n請先用【顏色】與【反差】判斷 env，"
        "再用【亮度】的主體數字判斷 verdict。"
    )
    return "\n".join(parts)


def custom_text(intent: str, current: dict | None) -> str:
    parts = [INTENT_GUIDE.get(intent, INTENT_GUIDE["product"])]
    if intent == "food":
        parts.append(FOOD_OBJECT_GUIDE)
    if current:
        parts.append(
            f"\n目前用的是「{current.get('name', '')}」，"
            f"有 {len(current.get('slots', []))} 個位置，但不適合這個畫面。"
        )
    return "\n".join(parts)
