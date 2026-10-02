"""Malformed upload recovery; only isolated generated workbooks, no provider calls."""
import io
import struct
import zipfile
import zlib
import pytest
from openpyxl import Workbook


def workbook():
    book=Workbook();book.active.append(['period','revenue','cost']);book.active.append(['2025-Q1',100,80])
    stream=io.BytesIO();book.save(stream);book.close();return stream.getvalue()


def altered_workbook(changes):
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(workbook())) as source,zipfile.ZipFile(out,'w') as target:
        for item in source.infolist():
            data=changes.get(item.filename,source.read(item.filename))
            if data is not None:target.writestr(item.filename,data)
    return out.getvalue()


def bad_file(kind):
    if kind=='truncated':return b'PK truncated workbook'
    if kind=='corrupt_deflate':
        raw=bytearray(workbook())
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            member=archive.getinfo('[Content_Types].xml')
            assert member.compress_type==zipfile.ZIP_DEFLATED
            name_length,extra_length=struct.unpack_from('<HH',raw,member.header_offset+26)
            offset=member.header_offset+30+name_length+extra_length
        raw[offset:offset+2]=b'\xff\xff'
        return bytes(raw)
    if kind=='not_workbook':
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as target:target.writestr('readme.txt','not a workbook')
        return out.getvalue()
    if kind=='malformed_manifest':return altered_workbook({'[Content_Types].xml':b'<Types'})
    if kind=='missing_workbook':return altered_workbook({'xl/workbook.xml':None})
    if kind=='no_workbook_part':return altered_workbook({'[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'})
    if kind=='malformed_sheet':return altered_workbook({'xl/worksheets/sheet1.xml':b'<worksheet'})
    raise AssertionError(kind)


def snapshot(store):
    return {table:store.all('SELECT * FROM '+table+' ORDER BY rowid') for table in ('datasets','dataset_revisions','dataset_import_receipts','workspace_objects','audit')}


@pytest.mark.parametrize('kind',['truncated','corrupt_deflate','not_workbook','malformed_manifest','missing_workbook','no_workbook_part','malformed_sheet'])
@pytest.mark.parametrize('path',['/workspace/imports/file','/import/dataset'])
def test_malformed_workbooks_explain_file_repair_and_leave_saved_data_unchanged(actor,kind,path):
    row=actor.dataset();store=actor.client.app.state.store;before=snapshot(store)
    data={'company':row['payload']['company']}
    if path.startswith('/workspace'):data.update(target_id=row['id'],target_version=str(row['version']),merge_mode='merge')
    response=actor.post(path,data=data,files={'file':('broken.xlsx',bad_file(kind))})
    assert response.status_code==422,response.text
    assert response.json()['error']['code']=='IMPORT_REJECTED'
    assert 'XLSX' in response.json()['error']['message'] and '重新导出' in response.json()['error']['message']
    assert snapshot(store)==before


def test_corrupt_deflate_fixture_contains_real_invalid_compressed_bytes():
    with zipfile.ZipFile(io.BytesIO(bad_file('corrupt_deflate'))) as archive:
        with pytest.raises(zlib.error):archive.read('[Content_Types].xml')


def test_valid_workbook_still_previews_without_writing_financial_data(actor):
    response=actor.post('/workspace/imports/file',data={'company':'隔离测试企业'},files={'file':('valid.xlsx',workbook())})
    assert response.status_code==201,response.text
    assert response.json()['payload']['dataset']['periods'][0]['revenue']==100
    assert actor.get('/datasets').json()['items']==[]


@pytest.mark.parametrize('error',[KeyError('unexpected internal key'),RuntimeError('unexpected parser defect'),OSError('unexpected operating error')])
def test_unrecognized_parser_failures_are_not_misreported_as_bad_user_files(actor,monkeypatch,error):
    def broken(*args,**kwargs):raise error
    monkeypatch.setattr('openpyxl.load_workbook',broken)
    response=actor.post('/workspace/imports/file',data={'company':'隔离测试企业'},files={'file':('valid.xlsx',workbook())})
    assert response.status_code==500,response.text
    assert response.json()['error']['code']=='INTERNAL_ERROR'
    assert actor.get('/datasets').json()['items']==[]


def test_zip_safety_rejection_keeps_its_specific_limit_message(actor):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:archive.writestr('../unsafe.xml','x')
    response=actor.post('/workspace/imports/file',data={'company':'隔离测试企业'},files={'file':('unsafe.xlsx',stream.getvalue())})
    assert response.status_code==422
    assert '压缩内容不安全' in response.json()['error']['message']
    assert actor.get('/datasets').json()['items']==[]
