import os
# Define CFG object to match import expectations
class CFG:
    INPUT_XLSX  = "Full election tables.xlsx"
    MODEL_DIR   = r"C:\Users\scomo\OneDrive\Documents"
    TRANSFER_MODEL_PATH   = os.path.join(MODEL_DIR, "NI-transfer-model.joblib")
    TRANSFER_META_PATH    = os.path.join(MODEL_DIR, "NI-transfer-model.meta.json")
    REFERENDUM_MODEL_PATH = os.path.join(MODEL_DIR, "NI-referendum-model.joblib")
    REFERENDUM_META_PATH  = os.path.join(MODEL_DIR, "NI-referendum-model.meta.json")
    OUTPUT_TRANSFERS_XLSX   = os.path.join(MODEL_DIR, "Projected preferences (filtered).xlsx")
    OUTPUT_REFERENDUM_XLSX  = os.path.join(MODEL_DIR, "Projected referendum results.xlsx")
    STV_EVENTS = ["DevolvedElection", "EuropeanElection"]
    REFERENDUM_TYPES = ["Referendum", "RecallPetition"]
    REFERENDUM_BODY_ELECTION_FAMILIES = {
        "northern ireland assembly": ("DevolvedElection",),
        "northern ireland constitutional convention": (
            "ConstitutionalConvention",
            "DevolvedElection",
        ),
        "northern ireland forum for political dialogue": (
            "ForumElection",
            "DevolvedElection",
        ),
        "european parliament": ("EuropeanElection", "DevolvedElection"),
        "house of commons of the united kingdom": ("WestminsterElection",),
    }
    REFERENDUM_EVENT_TYPE_FAMILIES = {
        "devolvedelection": ("DevolvedElection",),
        "europeanelection": ("EuropeanElection", "DevolvedElection"),
        "westminsterelection": ("WestminsterElection",),
    }
    SIM_BALLOTS_PER_CONSTITUENCY = None
    MAX_SIM_BALLOTS_PER_GROUP = 10000
    MIN_COMBO_COUNT_TO_SAVE = 5
    MAX_RANK = 8
    RANDOM_SEED = 42
    OHE_HANDLE_UNKNOWN = "infrequent_if_exist"
    OHE_MIN_FREQUENCY = 1
    TOPK_SOURCE_PID = 200
    EMBEDDING_DIM = 32
    TRANSFERS_CV_SHUFFLE = True
    TRANSFERS_CV_FOLDS = 5
    REF_CV_FOLDS = 5
    ADHERENCE = 0.85
    UNDECIDED_TO_VOTE = 0.40
    REAL_ROW_MULTIPLIER = 2
    PSEUDO_ROW_MULTIPLIER = 3
    TARGET_DATE = None
    USE_ML_TABLES = True
    ML_TABLE_DIR = MODEL_DIR
    SOURCE_GROUPS_CSV        = os.path.join(ML_TABLE_DIR, "SourceGroups")
    EVENT_EDGES_CSV          = os.path.join(ML_TABLE_DIR, "EventEdges")
    LOCAL_COMPOSITIONS_CSV   = os.path.join(ML_TABLE_DIR, "LocalCompositions")
    CANDIDATE_SNAPSHOTS_CSV  = os.path.join(ML_TABLE_DIR, "CandidateSnapshots")
    TRANSFERS_SHEET_ORDER = (
        "AdjustedTransfers",
        "Transfers",
        "STV Transfers",
        "Counts",
        "Transfer",
    )

# Alias for direct module access (e.g. from ni_votes.config import INPUT_XLSX)
INPUT_XLSX = CFG.INPUT_XLSX
MODEL_DIR = CFG.MODEL_DIR
TRANSFER_MODEL_PATH = CFG.TRANSFER_MODEL_PATH
TRANSFER_META_PATH = CFG.TRANSFER_META_PATH
REFERENDUM_MODEL_PATH = CFG.REFERENDUM_MODEL_PATH
REFERENDUM_META_PATH = CFG.REFERENDUM_META_PATH
OUTPUT_TRANSFERS_XLSX = CFG.OUTPUT_TRANSFERS_XLSX
OUTPUT_REFERENDUM_XLSX = CFG.OUTPUT_REFERENDUM_XLSX
STV_EVENTS = CFG.STV_EVENTS
REFERENDUM_TYPES = CFG.REFERENDUM_TYPES
REFERENDUM_BODY_ELECTION_FAMILIES = CFG.REFERENDUM_BODY_ELECTION_FAMILIES
REFERENDUM_EVENT_TYPE_FAMILIES = CFG.REFERENDUM_EVENT_TYPE_FAMILIES
SIM_BALLOTS_PER_CONSTITUENCY = CFG.SIM_BALLOTS_PER_CONSTITUENCY
MAX_SIM_BALLOTS_PER_GROUP = CFG.MAX_SIM_BALLOTS_PER_GROUP
MIN_COMBO_COUNT_TO_SAVE = CFG.MIN_COMBO_COUNT_TO_SAVE
MAX_RANK = CFG.MAX_RANK
RANDOM_SEED = CFG.RANDOM_SEED
OHE_HANDLE_UNKNOWN = CFG.OHE_HANDLE_UNKNOWN
OHE_MIN_FREQUENCY = CFG.OHE_MIN_FREQUENCY
TOPK_SOURCE_PID = CFG.TOPK_SOURCE_PID
EMBEDDING_DIM = CFG.EMBEDDING_DIM
TRANSFERS_CV_SHUFFLE = CFG.TRANSFERS_CV_SHUFFLE
TRANSFERS_CV_FOLDS = CFG.TRANSFERS_CV_FOLDS
REF_CV_FOLDS = CFG.REF_CV_FOLDS
ADHERENCE = CFG.ADHERENCE
UNDECIDED_TO_VOTE = CFG.UNDECIDED_TO_VOTE
REAL_ROW_MULTIPLIER = CFG.REAL_ROW_MULTIPLIER
PSEUDO_ROW_MULTIPLIER = CFG.PSEUDO_ROW_MULTIPLIER
TARGET_DATE = CFG.TARGET_DATE
USE_ML_TABLES = CFG.USE_ML_TABLES
ML_TABLE_DIR = CFG.ML_TABLE_DIR
SOURCE_GROUPS_CSV = CFG.SOURCE_GROUPS_CSV
EVENT_EDGES_CSV = CFG.EVENT_EDGES_CSV
LOCAL_COMPOSITIONS_CSV = CFG.LOCAL_COMPOSITIONS_CSV
CANDIDATE_SNAPSHOTS_CSV = CFG.CANDIDATE_SNAPSHOTS_CSV
TRANSFERS_SHEET_ORDER = CFG.TRANSFERS_SHEET_ORDER