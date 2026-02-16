"""Political party mapping system for Northern Ireland elections."""

from typing import Dict, Optional, Tuple
import re


class PoliticalMapper:
    """Maps Northern Ireland political parties to bloc and constitutional stance categories."""
    
    # Class-level cache for party mappings to avoid repeated processing
    _party_cache: Dict[str, Dict[str, str]] = {}
    
    def __init__(self):
        # Unionist bloc - pro-union
        self.unionist_parties = {
            'DUP', 'UUP', 'TUV', 'PUP', 'UKIP', 'UKUP', 'Conservative',
            'Vanguard Unionist Progressive Party', 'Unionist Party of Northern Ireland',
            'United Ulster Unionist Party', 'Northern Ireland Unionist Party',
            'South Belfast Unionists', 'Ulster Popular Unionist Party',
            'Protestant Unionist Party', 'Ulster Democratic Party', 'Ulster Constitution Party',
            'BNP', 'National Front', 'Heritage Party', 'NI21'
        }
        
        # Nationalist bloc - pro-unity  
        self.nationalist_parties = {
            'Sinn F\u00e9in', 'SDLP', 'Aont\u00fa', 'Aont�', 'Nationalist Party',
            'Republican Labour Party', 'IRSP', 'Republican Sinn F\u00e9in', 'Republican Sinn F�in',
            'National Democratic Party', 'Unity', 'Irish Independence Party',
            'Independent (Oliver McMullan)'
        }
        
        # Other bloc - various stances
        self.other_pro_union = {'Ulster Liberal Party'}
        
        self.other_pro_unity = {
            'People Before Profit Alliance', 'Workers Party / Republican Clubs',
            'People\'s Democracy', 'Socialist Environmental Alliance'
        }
        
        self.other_unaligned = {
            'Alliance', 'Green / Ecology', 'NI Labour', 'Cross-Community Labour Alternative',
            'Natural Law', 'CISTA', 'Animal Welfare Party',
            'Vote For Yourself / Rainbow Dream Ticket / Make Politicians History',
            'Democratic Partnership', 'Procapitalism', 'Democracy First',
            'Northern Ireland First', 'United Labour Party', 'Labour \'87',
            'Derry Labour and Trade Union Party', 'Labour Coalition',
            'Communist Party of Ireland', 'Communist Party of Ireland (Marxist-Leninist)',
            'Building Worker', 'Ulster\'s Independent Voice', 'Resume NI',
            'Democratic Left / New Agenda', 'New Agenda'
        }
        
        # Independence movement
        self.independence_parties = {
            'Independent - Northern Ireland independence', 'Ulster Independence Movement',
            'Ulster Third Way'
        }
        
        # Time-dependent mappings
        self.time_dependent = {
            'Alliance': self._map_alliance_time_dependent
        }
    
    def _map_alliance_time_dependent(self, date_str: str) -> Dict[str, str]:
        """Alliance was pro-union until June 1999, then unaligned."""
        try:
            if date_str and len(date_str) >= 4:
                year = int(date_str[:4])
                if year < 1999 or (year == 1999 and len(date_str) >= 7 and int(date_str[5:7]) < 6):
                    return {'bloc': 'other', 'const_stance': 'pro-union'}
                else:
                    return {'bloc': 'other', 'const_stance': 'unaligned'}
        except:
            pass
        return {'bloc': 'other', 'const_stance': 'unaligned'}
    
    def map_party(self, party_name: str, date_str: Optional[str] = None) -> Dict[str, str]:
        """Map a party name to political categories."""
        if not party_name or not isinstance(party_name, str):
            return {'bloc': 'unknown', 'const_stance': 'unknown'}
        
        # Create cache key (date_str affects time-dependent mappings)
        cache_key = f"{party_name}|{date_str or ''}"
        
        # Check cache first
        if cache_key in self._party_cache:
            return self._party_cache[cache_key]
        
        # Clean the party name
        clean_name = party_name.strip()
        
        # Handle encoding issues
        if 'Sinn F' in clean_name and ('ein' in clean_name or '�in' in clean_name):
            clean_name = 'Sinn Féin'
        elif 'Aont' in clean_name and ('ú' in clean_name or '�' in clean_name):
            clean_name = 'Aontú'
        
        # Check for time-dependent mappings first
        for party, mapper in self.time_dependent.items():
            if party in clean_name:
                result = mapper(date_str)
                self._party_cache[cache_key] = result
                return result
        
        # Apply your mapping rules
        result = None
        if 'Unionist' in clean_name:
            result = {'bloc': 'unionist', 'const_stance': 'pro-union'}
        elif clean_name == 'Independent' and not any(x in clean_name for x in ['Independent Unionist', 'Independent Nationalist', 'Independent Other']):
            result = {'bloc': 'unknown', 'const_stance': 'unknown'}
        elif clean_name in self.unionist_parties:
            result = {'bloc': 'unionist', 'const_stance': 'pro-union'}
        elif clean_name in self.nationalist_parties:
            result = {'bloc': 'nationalist', 'const_stance': 'pro-unity'}
        elif clean_name in self.other_pro_union:
            result = {'bloc': 'other', 'const_stance': 'pro-union'}
        elif clean_name in self.other_pro_unity:
            result = {'bloc': 'other', 'const_stance': 'pro-unity'}
        elif clean_name in self.other_unaligned:
            result = {'bloc': 'other', 'const_stance': 'unaligned'}
        elif clean_name in self.independence_parties:
            result = {'bloc': 'Northern Ireland independence', 'const_stance': 'pro-independence'}
        elif 'Independent Unionist' in clean_name:
            result = {'bloc': 'unionist', 'const_stance': 'pro-union'}
        elif 'Independent Nationalist' in clean_name:
            result = {'bloc': 'nationalist', 'const_stance': 'pro-unity'}
        elif 'Independent Other' in clean_name:
            result = {'bloc': 'other', 'const_stance': 'unaligned'}
        elif 'Independent - Northern Ireland independence' in clean_name:
            result = {'bloc': 'Northern Ireland independence', 'const_stance': 'pro-independence'}
        else:
            # Default for unknown parties
            result = {'bloc': 'unknown', 'const_stance': 'unknown'}
        
        # Cache the result
        self._party_cache[cache_key] = result
        return result
    
    def get_bloc_features(self, donor_party: str, recipient_party: str, date_str: Optional[str] = None) -> Dict[str, int]:
        """Generate bloc relationship features for a donor-recipient pair."""
        donor_map = self.map_party(donor_party, date_str)
        recipient_map = self.map_party(recipient_party, date_str)
        
        features = {}
        
        # Basic bloc flags
        features['donor_bloc_unionist'] = 1 if donor_map['bloc'] == 'unionist' else 0
        features['donor_bloc_nationalist'] = 1 if donor_map['bloc'] == 'nationalist' else 0
        features['donor_bloc_other'] = 1 if donor_map['bloc'] == 'other' else 0
        features['donor_bloc_independence'] = 1 if donor_map['bloc'] == 'Northern Ireland independence' else 0
        
        features['recipient_bloc_unionist'] = 1 if recipient_map['bloc'] == 'unionist' else 0
        features['recipient_bloc_nationalist'] = 1 if recipient_map['bloc'] == 'nationalist' else 0
        features['recipient_bloc_other'] = 1 if recipient_map['bloc'] == 'other' else 0
        features['recipient_bloc_independence'] = 1 if recipient_map['bloc'] == 'Northern Ireland independence' else 0
        
        # Relationship features
        features['same_bloc'] = 1 if donor_map['bloc'] == recipient_map['bloc'] else 0
        features['cross_bloc'] = 1 if (donor_map['bloc'] != recipient_map['bloc'] and 
                                      donor_map['bloc'] != 'other' and 
                                      recipient_map['bloc'] != 'other') else 0
        
        features['u_to_n'] = 1 if (donor_map['bloc'] == 'unionist' and recipient_map['bloc'] == 'nationalist') else 0
        features['n_to_u'] = 1 if (donor_map['bloc'] == 'nationalist' and recipient_map['bloc'] == 'unionist') else 0
        features['to_other'] = 1 if recipient_map['bloc'] == 'other' else 0
        features['from_other'] = 1 if donor_map['bloc'] == 'other' else 0
        
        # Bloc distance (0=same, 1=to/from other, 2=unionist↔nationalist)
        if donor_map['bloc'] == recipient_map['bloc']:
            features['bloc_distance'] = 0
        elif (donor_map['bloc'] == 'other' or recipient_map['bloc'] == 'other'):
            features['bloc_distance'] = 1
        elif (donor_map['bloc'] == 'unionist' and recipient_map['bloc'] == 'nationalist') or \
             (donor_map['bloc'] == 'nationalist' and recipient_map['bloc'] == 'unionist'):
            features['bloc_distance'] = 2
        else:
            features['bloc_distance'] = 1  # Other combinations
        
        return features
    
    def get_constitutional_features(self, donor_party: str, recipient_party: str, date_str: Optional[str] = None) -> Dict[str, int]:
        """Generate constitutional stance features for a donor-recipient pair."""
        donor_map = self.map_party(donor_party, date_str)
        recipient_map = self.map_party(recipient_party, date_str)
        
        features = {}
        
        # Donor constitutional stance
        features['donor_const_pro_union'] = 1 if donor_map['const_stance'] == 'pro-union' else 0
        features['donor_const_pro_unity'] = 1 if donor_map['const_stance'] == 'pro-unity' else 0
        features['donor_const_unaligned'] = 1 if donor_map['const_stance'] == 'unaligned' else 0
        features['donor_const_pro_independence'] = 1 if donor_map['const_stance'] == 'pro-independence' else 0
        
        # Recipient constitutional stance
        features['recipient_const_pro_union'] = 1 if recipient_map['const_stance'] == 'pro-union' else 0
        features['recipient_const_pro_unity'] = 1 if recipient_map['const_stance'] == 'pro-unity' else 0
        features['recipient_const_unaligned'] = 1 if recipient_map['const_stance'] == 'unaligned' else 0
        features['recipient_const_pro_independence'] = 1 if recipient_map['const_stance'] == 'pro-independence' else 0
        
        return features