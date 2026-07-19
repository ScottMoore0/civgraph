import pandas as pd, numpy as np, json, warnings
warnings.filterwarnings('ignore')
import statsmodels.formula.api as smf
import statsmodels.api as sm
from sklearn.ensemble import HistGradientBoostingClassifier

df=pd.read_csv('nilt_individual.csv')
# complete cases; drop degenerate 2017 border-poll cell
df=df.dropna(subset=['community','age_band','sex'])
df=df[~((df.source=='nilt_ref')&(df.year==2017))]
df['year_c']=df.year-2020
print("training rows:",len(df),"| sources:",dict(df.source.value_counts()))

# ---- GLM backbone: learned demographics x time + measure-source offset ----
# source: nilt_ref (direct border-poll) is the target measure; nilt_pref offset is learned
glm=smf.glm('unity ~ C(community)*C(age_band) + C(sex) + year_c + C(source)',
            data=df, family=sm.families.Binomial(), freq_weights=df['weight']).fit()
src_off=glm.params.get('C(source)[T.nilt_ref]',0.0)
print("\nLearned measure offset (nilt_ref - nilt_pref), logit: %.3f"%src_off)
print("Learned year trend (per yr), logit: %.4f"%glm.params['year_c'])

# ---- GBM cross-check ----
X=pd.get_dummies(df[['community','age_band','sex','source']],drop_first=False)
X['year_c']=df['year_c']
gbm=HistGradientBoostingClassifier(max_depth=3,learning_rate=0.08,max_iter=300,
     min_samples_leaf=40,l2_regularization=1.0).fit(X,df['unity'],sample_weight=df['weight'].values)

# ---- predictions on the census cell grid (community x age x sex), at nilt_ref measure ----
GRPS=['C','P','O'];AGES=['18-24','25-34','35-44','45-54','55-64','65+'];SEX=['M','F']
YEARS={'2021-01':2021,'2022-08':2022,'2024-02':2024,'2025-02':2025}
cells=[(g,a,s) for g in GRPS for a in AGES for s in SEX]
def glm_pred(g,a,s,yr):
    row=pd.DataFrame([{'community':g,'age_band':a,'sex':s,'year_c':yr-2020,'source':'nilt_ref'}])
    return float(glm.predict(row).iloc[0])
def gbm_pred(g,a,s,yr):
    row=pd.DataFrame([{'community':g,'age_band':a,'sex':s,'source':'nilt_ref','year_c':yr-2020}])
    rx=pd.get_dummies(row[['community','age_band','sex','source']]).reindex(columns=X.columns,fill_value=0)
    rx['year_c']=yr-2020
    return float(gbm.predict_proba(rx)[0,1])
pred={}
for date,yr in YEARS.items():
    pred[date]={f"{g}|{a}|{s}":{'glm':round(glm_pred(g,a,s,yr),4),'gbm':round(gbm_pred(g,a,s,yr),4)} for g,a,s in cells}
json.dump({'source_offset_ref_minus_pref':round(src_off,4),'year_trend_logit':round(float(glm.params['year_c']),4),
           'glm_params':{k:round(float(v),4) for k,v in glm.params.items()},
           'cell_predictions':pred,'cells':[f"{g}|{a}|{s}" for g,a,s in cells],'years':YEARS},
          open('model_fit.json','w'),indent=1)
# community-marginal sanity (unweighted over age/sex) at 2024
print("\nModel unity by community @2024 (nilt_ref), GLM / GBM (simple mean over age,sex):")
for g in GRPS:
    gl=np.mean([glm_pred(g,a,s,2024) for a in AGES for s in SEX])
    gb=np.mean([gbm_pred(g,a,s,2024) for a in AGES for s in SEX])
    print("  %s: GLM %.1f%%  GBM %.1f%%"%(g,100*gl,100*gb))
print("\nwrote model_fit.json")
