/**
 * Handle track event
 * @param  {SegmentTrackEvent} event
 * @param  {FunctionSettings} settings
 */

/*
SETTINGS:
- Adobe Schema ID: adobeSchemaId
- Adobe Organization ID: adobeOrganizationId
- Adobe Dataset ID: adobeDatasetId
- Adobe Dataflow ID: adobeDataflowId
- Adobe Streaming Endpoint: adobeStreamingEndpoint
- Adobe Token: adobeToken
- Adobe Debug Mode (TRUE - debug mode on: adds "?syncValidation=true" to Adobe URL, FALSE - debug mode off): adobeDebugMode

1. Profile Updates
- adobeProfileSchemaId
	Name: Adobe Profile Schema ID
	Description: Adobe Profile Schema ID
	Type: string
	Required: yes
- adobeProfileDatasetId
	Name: Adobe Profile Dataset ID
	Description: Adobe Profile Dataset ID
	Type: string
	Required: yes
- adobeProfileDataflowId
	Name: Adobe Profile Dataflow ID
	Description: Adobe Profile Dataflow ID
	Type: string
	Required: yes
- adobeProfileEndpoint
	Name: Adobe Profile Streaming Endpoint
	Description: Adobe Profile Streaming Endpoint
	Type: string
	Required: yes
2. General Settings
- adobeOrganizationId
	Name: Adobe Organization ID
	Description: Adobe Organization ID
	Type: string
	Required: yes
- adobeToken
	Name: Adobe Token
	Description: Adobe Token, used to authenticate with Adobe API. Updated by scheduled job. Do not modify this setting.
	Type: string, sensitive
	Required: no
- adobeDebugMode
	Name: Adobe Debug Mode
	Description: Enable debug mode for Adobe API. Adds "?syncValidation=true" to Adobe URL.
	Type: boolean
	Required: no
- segmentWritekey
	Name: Adobe Errors Source Writekey
	Description: Write Key of the source where Adobe errors should be sent.
	Type: string
	Required: yes
*/

async function onBatch(events, settings) {
	console.log(JSON.stringify(events));
	uuidv5 = uuidv5.uuidv5;

	let filtered_events = JSON.parse(JSON.stringify(events));

	// 1. Handle Adobe Profile update
	let adobe_profile_data_arr = events.map(event => build_adobe_payload(event, settings, uuidv5));
	let adobe_profile_req_body = { messages: adobe_profile_data_arr };
	console.log('Making Adobe Profile Request with payload:', JSON.stringify(adobe_profile_req_body));
	let adobe_profile_response = await send_data_to_adobe(adobe_profile_req_body, settings, true);
	let adobe_profile_errors = check_adobe_response(adobe_profile_response, events, adobe_profile_req_body);

	// If there were errors, remove the events that caused the error from the original batch, and use cleaned up batch to make event updates. Then send error logs to Segment
	// Make a deep copy of the original events array to avoid mutation
	if (adobe_profile_errors.length > 0) {
		// Find Segment messageIds that failed
		let failed_messageIds = adobe_profile_errors.map(error => error.properties.messageId);
		// Filter out failed messages
		filtered_events = events.filter(event => !failed_messageIds.includes(event.messageId));
		console.log(
			`Adobe profile update: some messages failed. Total messages failed: ${adobe_profile_errors.length} out of ${adobe_profile_data_arr.length}. Failed events messageIds: ${failed_messageIds.join(",")}. Sending error logs to Segment.`
		);
		let segment_responses = await Promise.allSettled(
			adobe_profile_errors.map(error => send_segment_event(error, settings))
		);
		console.log('Segment Responses:', segment_responses);
	} else {
		console.log(
			`Adobe profile data send: success. Errors: ${adobe_profile_errors.length}. Messages sent: ${adobe_profile_data_arr.length}`
		);
	}


	// // 2. Handle Adobe Event update
	// if (settings.sendEventData == true) {
	// 	let adobe_event_data_arr = filtered_events.map(event => build_adobe_payload(event, settings, false, uuidv5));
	// 	let adobe_event_req_body = { messages: adobe_event_data_arr };
	// 	console.log('Making Adobe Event Request', JSON.stringify(adobe_event_req_body));
	// 	let adobe_event_response = await send_data_to_adobe(adobe_event_req_body, settings, false);
	// 	let adobe_event_errors = check_adobe_response(adobe_event_response, filtered_events, adobe_event_req_body);
	// 	// If some events failed, send error logs to Segment
	// 	if (adobe_event_errors.length > 0) {
	// 		let failed_messageIds = adobe_event_errors.map(error => error.properties.segment_event.messageId);
	// 		console.log(
	// 			`Adobe event update: some messages failed. Total messages failed: ${adobe_event_errors.length} out of ${adobe_event_data_arr.length}. Failed events messageIds: ${failed_messageIds.join(",")}. Sending error logs to Segment.`
	// 		);
	// 		let segment_responses = await Promise.allSettled(
	// 			adobe_event_errors.map(error => send_segment_event(error, settings))
	// 		);
	// 		console.log('Segment Responses:', segment_responses);
	// 	} else {
	// 		console.log(
	// 			`Adobe event data send: success. Errors: ${adobe_event_errors.length}. Messages sent: ${adobe_event_data_arr.length}`
	// 		);
	// 	}
	// } else {
	// 	console.log('Event updates are disabled');
	// }
}
function format_bool(bool_str) {
    try {
        if (typeof bool_str === 'boolean') {
            return bool_str;
        }

        if (typeof bool_str === 'string') {
            const normalized = bool_str.toLowerCase();
            if (['true', 'y', 'yes', '1'].includes(normalized)) {
                return true;
            }
            if (['false', 'n', 'no', '0'].includes(normalized)) {
                return false;
            }
        }

        if (typeof bool_str === 'number') {
            if (bool_str === 1) return true;
            if (bool_str === 0) return false;
        }

        return null; // Fallback for unsupported types or invalid values
    } catch (e) {
        console.error('Error in format_bool:', e);
        return null;
    }
}

function format_date(date_str) {
  try {
    return new Date(date_str).toISOString();
  } catch (e) {
    return '';
  }
}

function recursive_build_adobe_payload(event, settings, is_profile, uuidv5, adobe_keymap) {
	console.log('start build_adobe_payload, is_profile: ', is_profile);
	const result = {};
	const recursive_search = (obj) => {
        if (typeof obj !== 'object' || obj === null) return;

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];

                // Check if the key exists in the mapping
                const outputKey = Object.keys(adobe_keymap).find(mappedKey => keyMap[mappedKey] === key);
                if (outputKey) {
                    result[outputKey] = value;
                }

                // If the value is an object, recurse into it
                if (typeof value === 'object' && value !== null) {
                    recursive_search(value);
                }
				
            }
        }
    };

    recursive_search(event);
    return result;
}

// Recursively remove null or empty values from the object
function recursive_remove_nulls(payload) {
	const recursive_search = (obj) => {
		if (typeof obj !== 'object' || obj === null) {
			return
		}

		for (const key in obj) {
			if (typeof obj[key] == 'object' || obj[key] != null) {
				recursive_search(obj[key])
			}
			if (obj.hasOwnProperty(key)) {
				if (obj[key] === null || obj[key] === '') {
					delete obj[key]
				}
			}
		}
		return obj
	}

	let result = recursive_search(payload);
	return result;
}

// Fallback to default values for required date fields and countryCode (MKTSEGMENT-1577)
function fallback_to_default(payload, is_profile) { //TBD, waiting for confirmation from IBM
	//console.log('start fallback_to_default');
	if (is_profile) {
		// Fallback date fields to default value '1970-01-01T00:00:00.000Z'
		if (payload.extSourceSystemAudit.lastUpdatedDate == null || payload.extSourceSystemAudit.lastUpdatedDate === '') {
			payload.extSourceSystemAudit.lastUpdatedDate = '1970-01-01T00:00:00.000Z';
		}

		if (payload.extSourceSystemAudit.createdDate == null || payload.extSourceSystemAudit.createdDate === '') {
			payload.extSourceSystemAudit.createdDate = '1970-01-01T00:00:00.000Z';
		}

		if (payload._ibm.b2bperson.controlData.personUpdatedTS == null || payload._ibm.b2bperson.controlData.personUpdatedTS === '') {
			payload._ibm.b2bperson.controlData.personUpdatedTS = '1970-01-01T00:00:00.000Z';
		}

		if (payload._ibm.b2bperson.controlData.personCreatedTS == null || payload._ibm.b2bperson.controlData.personCreatedTS === '') {
			payload._ibm.b2bperson.controlData.personCreatedTS = '1970-01-01T00:00:00.000Z';
		}

		// Fallback countryCode to default value 'US'
		if (payload.billingAddress.countryCode == null || payload.billingAddress.countryCode === '') {
			payload.billingAddress.countryCode = 'US';
		}

		// Fallback language to default value 'en_US'
		if (payload._ibm.b2bperson.indivDetails.prefLanguage == null || payload._ibm.b2bperson.indivDetails.prefLanguage === '') {
			payload._ibm.b2bperson.indivDetails.prefLanguage = 'en_US';
		}
		return payload;
	} 
	if (is_profile == false) {
		return payload;
	}
}

 

function build_adobe_payload(event, settings, uuidv5) {
	console.log('start build_adobe_payload, is_profile: ', is_profile);
	const properties = event.properties;
	//const person = event.properties.hasOwnProperty('person') && typeof event.properties.person == 'object' ? event.properties.person : event.properties ;
	//const calculations = event.properties.calculations;
	//const cmt_ver = event.properties.hasOwnProperty('cmtVer') && typeof event.properties.cmtVer == 'object' ? event.properties.cmtVer : event.properties;
	// const uuid_regex =
	//	/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	// var event_id; //Don't need this since we are only sending profile updates and not events
	// try {
	// 	event_id = event.context.geds.eventId;
	// } catch (e) {
	// 	// Generate new event Id with uuidv5(namespace, string).
	// 	// We use custom namespace, Id-d with a random uuid=df3ca537-8d6a-4b52-a4ba-868c17ed1ac7 with "-" removed
	// 	let namespace = 'df3ca537-8d6a-4b52-a4ba-868c17ed1ac7'.replace('-', '');
	// 	event_id = uuidv5(namespace, event.messageId);
	// }
	// let adobe_event_xdm_entity = {
	// 	_id: event_id,
	// 	timestamp: event.timestamp,
	// 	_ibm: {
	// 		milestone: {
	// 			planTypeCode: cmt_ver.planTypeCode ? String(cmt_ver.planTypeCode) : null,
	// 			planStatusCode: cmt_ver.planStatusCode ? String(cmt_ver.planStatusCode) : null,
	// 			//May 15.2025: MKTSEGMENT-1790 - added 2 new variables productPlanName and productPlanType
	// 			productPlanName: properties.productPlanName ? String(properties.productPlanName) : null,
	// 			productPlanType: properties.productPlanType ? String(properties.productPlanType) : null,

	// 			commonMilestoneName: properties.commonMilestoneName ? String(properties.commonMilestoneName) : '',
	// 			ctry: properties.commonMilestoneCountryCode ? String(properties.commonMilestoneCountryCode) : '',
	// 			event: event.event ? String(event.event) : '',
	// 			identities: {
	// 				instanceId: properties.instanceId ? String(properties.instanceId) : '',
	// 				urnIdmComp: person.companyId ? String(person.companyId) : '',
	// 				urnIdmIndiv: person.personId ? String(person.personId) : '',
	// 				wiIui: person.ibmUniqueId ? String(person.ibmUniqueId) : ''
	// 			},
	// 			productTitle: properties.productTitle ? String(properties.productTitle) : '',
	// 			ut30: properties.ut30 ? String(properties.ut30) : ''
	// 		}
	// 	},
	// 	personKey: {
	// 		sourceID: person.personId ? String(person.personId) : '',
    //   		sourceType: 'CDIP',
    //   		sourceInstanceID: 'CDIP-AEP',
    //   		sourceKey: person.personId ? `${person.personId}@CDIP-AEP.CDIP` : ''
	// 	}
	// };
	
	let adobe_profile_xdm_entity = {
		_ibm: {
			b2bperson: {
				classification: {
					bpFlag: properties.hasOwnProperty('bpFlag') ? (format_bool(properties.bpFlag)) : null,
					studentFlag: properties.hasOwnProperty('studentFlag') ? (format_bool(properties.studentFlag)) : null,
					ibmFlag: properties.hasOwnProperty('ibmFlag') ? (format_bool(properties.ibmFlag)) : null
				},
				contactDetails: {
					email: properties.email ? String(properties.email) : '',
				},
				controlData: {
					// Aug 6 2024: changed key names 
					personCreatedTS: properties.personCreatedTS ? format_date(properties.personCreatedTS) : '', 
					personUpdatedTS: properties.personUpdatedTS ? format_date(properties.personUpdatedTS) : '', 
					lastApplicationToMdm: properties.lastApplicationToUpdateMdm ? String(properties.lastApplicationToUpdateMdm) : '',
				},
				identities: {
					emailMediaId: properties.emailMediaId ? String(properties.emailMediaId) : '',
					workPhoneMediaId: properties.workPhoneMediaId ? String(properties.workPhoneMediaId) : '',
					mobilePhoneMediaId:  properties.mobilePhoneMediaId ? String(properties.mobilePhoneMediaId) : '',
					addressMediaId: properties.addressMediaId ? String(properties.addressMediaId) : '' 							// PubSub only
				},
				indivDetails: {
					prefLanguage: properties.prefLanguageCode ? String(properties.prefLanguageCode) : '',
					preferredNameAlternate: properties.personNameAlternative ? String(properties.personNameAlternative) : '',
					katakanaName: properties.katakanaName ? String(properties.katakanaName) : ''
				},
				job: {
					jobTitleUppercase: properties.jobTitleUppercase ? String(properties.jobTitleUppercase) : '',
					jobTitleStandard: properties.jobTitleStandard ? String(properties.jobTitleStandard) : '',
					jobTitleEnglish: properties.jobTitleEnglish ? String(properties.jobTitleEnglish) : '',
					jobRoleCode: properties.jobRoleCode ? String(properties.jobRoleCode) : '',
					jobLevelCode: properties.jobLevelCode ? String(properties.jobLevelCode) : '',
					jobClassCode: properties.jobClassCode ? String(properties.jobClassCode) : '',
					jobCategoryCode: properties.jobCategoryCode ? String(properties.jobCategoryCode) : ''
				},
				responsescore: {
					personConfidenceScore: properties.personContactTier ? String(properties.personContactTier) : '', 			// PubSub only
					personConfidenceDate: properties.personContactTierDate? format_date(properties.personContactTierDate) : ''	// PubSub only
				},
				dataquality: {
					dqIndivNameFlg: properties.dqIndivNameFlag ? format_bool(properties.dqIndivNameFlag) : null, 				// PubSub only
					dqAddressFlag: properties.dqAddressFlag ? format_bool(properties.dqAddressFlag) : null, 					// PubSub only
					dqEmailFlag: properties.dqEmailFlag ? format_bool(properties.dqEmailFlag) : null, 							// PubSub only
					dqWorkPhoneFlag: properties.dqWorkPhoneFlag ? format_bool(properties.dqWorkPhoneFlag) : null, 				// PubSub only
					dqMobilePhoneFlag: properties.dqMobilePhoneFlag ? format_bool(properties.dqMobilePhoneFlag) : null, 		// PubSub only
					dqJobTitleFlag: properties.dqJobTitleFlag ? format_bool(properties.dqJobTitleFlag) : null,
					dqFlg: properties.dqFlag ? format_bool(properties.dqFlag) : null 											// PubSub only 
				},
				location:{
					iotCode: properties.geographyCode ? String(properties.geographyCode) : '',
					iotDescription: properties.geographyDescription ? String(properties.geographyDescription) : '',
					imtCode: properties.marketCode ? String(properties.marketCode) : '', 
					imtDescription: properties.marketDescription ? String(properties.marketDescription) : '',
					regionCode: properties.regionCode ? String(properties.regionCode) : '',
					regionDescription: properties.regionDescription ? String(properties.regionDescription) : ''
				}
			}
		},
		b2b: {
			accountKey: {
				sourceID: properties.companyId ? String(properties.companyId) : '',
				sourceInstanceID: 'CDIP-AEP',
				sourceKey: properties.companyId ? `${properties.companyId}@CDIP-AEP.CDIP` : '',
				sourceType: 'CDIP'
			},
			personKey: {
				sourceID: properties.personId ? String(properties.personId) : '',
				sourceInstanceID: 'CDIP-AEP',
				sourceKey: properties.personId ? `${properties.personId}@CDIP-AEP.CDIP` : '',
				sourceType: 'CDIP'
			},
			personStatus: properties.personStatusCode ? String(properties.personStatusCode) : ''
		},
		billingAddress: {
			countryCode: properties.countryCode ? String(properties.countryCode) : ''
		},
		extSourceSystemAudit: {
			createdDate: properties.dataSourceCreatedTS ? format_date(properties.dataSourceCreatedTS) : '',
			externalKey: {
				sourceInstanceID: properties.dataSourceCode ? String(properties.dataSourceCode) : ''
			},
			lastUpdatedDate: properties.dataSourceUpdatedTS ? format_date(properties.dataSourceUpdatedTS) : ''
		},
		extendedWorkDetails: {
			jobTitle: properties.jobTitle ? String(properties.jobTitle) : ''
		},
		//isDeleted: false, //TBD, need confirmation from IBM
		mobilePhone: {
			number: properties.mobilePhoneNumber ? String(properties.mobilePhoneNumber) : ''
		},
		person: {
			name: {
				courtesyTitle: properties.courtesyTitle ? String(properties.courtesyTitle) : '',
				firstName: properties.firstName ? String(properties.firstName) : '',
				lastName: properties.lastName ? String(properties.lastName) :  '',
				middleName: properties.middleName ? String(properties.middleName) : '',
				suffix: properties.nameSuffix ? String(properties.nameSuffix): ''
			}
		},
		personComponents: [
			{
				sourceAccountKey: {
					sourceID: properties.companyId ? String(properties.companyId) : '',
					sourceInstanceID: 'CDIP-AEP',
					sourceKey: properties.companyId ? `${properties.companyId}@CDIP-AEP.CDIP`: '',
					sourceType: 'CDIP'
				}
			}
		],
		personID: properties.personId ? String(properties.personId) :  '',
		workAddress: {
			city: properties.city ? String(properties.city) : '',
			country: properties.country ? String(properties.country) : '',
			countryCode: properties.countryCode ? String(properties.countryCode) : '',
			postalCode: properties.postalCode ? String(properties.postalCode) : '',
			//primary: true,
			street1: properties.address ? String(properties.address) : '',
			street2: properties.addressLine2 ? String(properties.addressLine2) : '',
			street3: properties.addressLine3 ? String(properties.addressLine3) : '',
			state: properties.stateProvince
				? (String(properties.stateProvince).length === 5
					? String(properties.stateProvince).substring(3, 5)
					: String(properties.stateProvince).length === 2
						? String(properties.stateProvince)
						: null)
				: null
		},
		workPhone: {
			number: properties.workPhoneNumber ? String(properties.workPhoneNumber) : ''
		},
		_repo:{
			createDate: properties.dataSourceCreatedTS ? format_date(properties.dataSourceCreatedTS) : '',
			modifyDate: properties.dataSourceUpdatedTS ? format_date(properties.dataSourceUpdatedTS) : '',
		}
	};

	//if (is_profile == true) {
	console.log('Adobe Profile XDM Entity orig:', JSON.stringify(adobe_profile_xdm_entity));
	adobe_profile_xdm_entity = fallback_to_default(adobe_profile_xdm_entity, true);
	adobe_profile_xdm_entity = recursive_remove_nulls(adobe_profile_xdm_entity);
	console.log('Adobe Profile XDM Entity converted:', JSON.stringify(adobe_profile_xdm_entity));
	//}
	
	// Aug 28 2024: temporary fix for studentFlag attribute. AEP returns an error when the attribute is Null. This is not expected as AEP does not throw the same error for the other Boolean attributes.
	// Per customer request we remove all Bool attributes if they are null.
	// Apr 22 2025: this is now implemented with recursive_remove_nulls() function

	// if (is_profile == false) {
	// 	console.log('Adobe Event XDM Entity Orig:', JSON.stringify(adobe_event_xdm_entity))
	// 	adobe_event_xdm_entity = fallback_to_default(adobe_event_xdm_entity, false);
	// 	adobe_event_xdm_entity = recursive_remove_nulls(adobe_event_xdm_entity);
	// 	console.log('Adobe Event XDM Entity Converted:', JSON.stringify(adobe_event_xdm_entity));
	// }

	let org_id = settings.adobeOrganizationId;
	let schema_id =  settings.adobeProfileSchemaId;
	let dataset_id = settings.adobeProfileDatasetId;
	let dataflow_id = settings.adobeProfileDataflowId;
	// Added just for testing of AEP API errors caused by wrong AEP schema ID / dataflow ID / dataset ID
	// if (event.properties.test_failure) {
	// 	schema_id = 'foobar'
	// 	dataflow_id = 'foobar'
	// 	dataset_id = 'foobar'
	// }
	let adobe_xdm_meta = {
		schemaRef: {
			id: schema_id,
			contentType: 'application/vnd.adobe.xed-full+json;version=1'
		}
	};
	
	let adobe_header = {
		schemaRef: {
			id: schema_id,
			contentType: 'application/vnd.adobe.xed-full+json;version=1'
		},
		imsOrgId: org_id,
		datasetId: dataset_id,
		flowId: dataflow_id
	};
	let adobe_payload = {
		header: adobe_header,
		body: {
			xdmMeta: adobe_xdm_meta,
			xdmEntity: adobe_profile_xdm_entity
		}
	};
	
	return adobe_payload;
}


async function send_data_to_adobe(data, settings, is_profile_update) {
	console.log('start send_data_to_adobe, is_profile_update: ', is_profile_update);
	let url;
	if (is_profile_update) {
		url = settings.adobeProfileEndpoint;
	} else {
		url = settings.adobeEventEndpoint;
	}
	
	// Enable debug mode
	if (settings.adobeDebugMode) {
		url += '?syncValidation=true';
	}

	// Make sure 'batch' is in the URL
	if (!url.includes('/batch/')) {
		url = url.replace('collection', 'collection/batch');
	}
	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${settings.adobeToken}`
	};
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(data)
		});
	} catch (e) {
		console.log('Adobe Response:', e);
		throw new Error('Adobe request HTTP error: ', e);
	}	

	// Generally, if there is no HTTP errors, Adobe /batch/ endpoints returns 207 Multi-Status
	// Return response JSON to be parsed and errors logged
	if (response.status === 207) {
		console.log('Adobe Response:', response.status, response.statusText);
		let json = await response.json();
		// console.log(JSON.stringify(json));
		return json;
	}
	if (response.status === 429 || response.status === 503) {
		console.log('Adobe Response:', response.status, response.statusText);
		throw new RetryError(
			'Adobe API rate limit exceeded, retrying the batch',
			response.status
		);
	} else {
		console.log('Adobe Response:', response.status, response.statusText);
		throw new ValidationError('Adobe API error', response.status);
	}
}

// Parse Adobe Response, and generate error log to be sent to Segment
// Log message includes: original event, Adobe payload and Adobe response

function check_adobe_response(adobe_resp_json, inbound_batch, adobe_payloads) {
	console.log('start check_adobe_response');
	console.log('Adobe Response:', JSON.stringify(adobe_resp_json));
	let adobe_resp = adobe_resp_json.responses;
	let log_arr = [];
	let log_meessage = {};
	let i = 0;
	adobe_resp.forEach(response => {
		// If Adobe response includes 'status' key - that is an error
		if (response.status) {
			log_meessage = {
				event: 'Adobe Error',
				type: 'track',
				anonymousId: 'ibm_aep_error_log',
				properties: {
					segment_event: inbound_batch[i],
					adobe_payload: adobe_payloads.messages[i],
					adobe_response: {
						adobe_batch: {
							inletId: adobe_resp_json.inletId,
							batchId: adobe_resp_json.batchId,
							receivedTimeMs: adobe_resp_json.receivedTimeMs
						},
						adobe_response: response
					}
				}
			};
			log_arr.push(log_meessage);
		}
		i++;
	});
	// Errors log is [] when there are no errors
	return log_arr;
}

async function send_segment_event(payload, settings) {
	let url = 'https://api.segment.io/v1/track';
	let seg_response = await fetch(url, {
		headers: new Headers({
			Authorization: 'Basic ' + btoa(settings.segmentWritekey + ':'),
			'Content-Type': 'application/json'
		}),
		body: JSON.stringify(payload),
		method: 'post'
	});
	if (seg_response.ok) {
		console.log('Segment error log sent ' + JSON.stringify(payload));
	} else if (seg_response.status == 429 || seg_response.status >= 500) {
		console.log(
			`Retryable error sending Segment error log. ${seg_response.status} ${seg_response.statusText} `
		);
		throw new RetryError(
			`Retryable error sending Segment error log. ${seg_response.status} ${seg_response.statusText} `
		);
	} else {
		console.log(
			`Non-retryable error sending Segment error log. ${seg_response.status} ${seg_response.statusText} `
		);
		throw new RetryError(
			`Non-retryable error sending Segment error log. ${seg_response.status} ${seg_response.statusText} `
		);
	}
}

/**
 * Exports for Testing Only
 */
try {
	if (process?.env['NODE_DEV'] === 'TEST') {
		module.exports = {
			format_date,
			build_adobe_payload,
			onBatch,
			recursive_remove_nulls,
			format_bool,
		};
	}
	/* c8 ignore next */
} catch (e) {} // eslint-disable-line no-empty