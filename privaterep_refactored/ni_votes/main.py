import pandas as pd
from ni_votes import config, data_loading, models_transfers, models_referendum

def main():
    xl = pd.ExcelFile(config.INPUT_XLSX)
    er = data_loading.load_election_results(xl)
    tr = data_loading.load_transfers_sheet(xl)
    en = data_loading.load_endorsements(xl)
    print("Loaded:", len(er), "results,", len(tr), "transfers,", len(en), "endorsements")

if __name__ == "__main__":
    main()
